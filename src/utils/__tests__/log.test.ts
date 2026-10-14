import { afterEach, expect, it, jest } from "@jest/globals";
import log, { logger, logError, logInfo, logWarning } from "../log";

afterEach(() => {
  jest.restoreAllMocks();
});

it.each(["log", "info", "warn", "error"] as const)(
  "preserves %s severity and diagnostic arguments",
  (level) => {
    const sink = jest.spyOn(console, level).mockImplementation(() => undefined);
    const error = new Error("Failure detail");
    logger[level]("Message:", error, 42);
    expect(sink).toHaveBeenCalledWith("Message:", error, 42);
    expect(sink.mock.contexts).toEqual([console]);
  },
);

it.each([
  ["log", logInfo],
  ["warn", logWarning],
  ["error", logError],
] as const)(
  "preserves %s severity and structured details through the bridge helper",
  (level, write) => {
    const sink = jest.spyOn(console, level).mockImplementation(() => undefined);
    const error = new Error("Failure detail");
    const details = { requestId: "request-1" };
    write("Message:", error, details, 42, null, undefined);
    expect(sink).toHaveBeenCalledWith(
      "Message:",
      error,
      details,
      42,
      null,
      undefined,
    );
  },
);

it("retains the existing log prefix", () => {
  const sink = jest.spyOn(console, "log").mockImplementation(() => undefined);
  log("Legacy message");
  expect(sink).toHaveBeenCalledWith("[LOG]: Legacy message");
});

it.each(["log", "info", "warn", "error"] as const)(
  "preserves empty and structured %s arguments",
  (level) => {
    const sink = jest.spyOn(console, level).mockImplementation(() => undefined);
    const details = { message: "diagnostic" };
    const values = [undefined, null, false, 1n, Symbol("diagnostic"), details];
    logger[level]();
    logger[level](...values);
    expect(sink.mock.calls[0]).toEqual([]);
    const forwarded = sink.mock.calls[1];
    expect(forwarded).toHaveLength(values.length);
    values.forEach((value, index) => {
      expect(forwarded?.[index] === value).toBe(true);
    });
  },
);

it.each(["log", "info", "warn", "error"] as const)(
  "preserves a failing %s sink and resolves the current method on every call",
  (level) => {
    const failure = new Error("Sink failed");
    const sink = jest.spyOn(console, level).mockImplementation(() => {
      throw failure;
    });
    expect(() => {
      logger[level]("first");
    }).toThrow(failure);
    sink.mockImplementation(() => undefined);
    logger[level]("second");
    expect(sink).toHaveBeenLastCalledWith("second");
    expect(sink.mock.contexts).toEqual([console, console]);
  },
);

const diagnosticEntrypoints = [
  ...(["log", "info", "warn", "error"] as const).map((level) => ({
    name: level,
    level,
    write: (message: string) => {
      logger[level](message);
    },
    message: "diagnostic",
  })),
  {
    name: "prefixed log",
    level: "log" as const,
    write: log,
    message: "[LOG]: diagnostic",
  },
];

// Diagnostics preserve the receiver, synchronous writes, return values and failures.
it.each(diagnosticEntrypoints)(
  "preserves synchronous sink writes and completion through $name",
  ({ level, write, message }) => {
    const events: string[] = [];
    const invoke = jest.fn(write);
    let writes = 0;
    jest.spyOn(console, level).mockImplementation(function (this: Console, ...values: unknown[]) {
      expect(this).toBe(console);
      expect(values).toEqual([message]);
      events.push(`write ${++writes}`);
      return "sink return value";
    });
    invoke("diagnostic");
    events.push("between");
    invoke("diagnostic");
    events.push("after");
    expect(invoke.mock.results).toEqual([
      { type: "return", value: undefined },
      { type: "return", value: undefined },
    ]);
    expect(events).toEqual(["write 1", "between", "write 2", "after"]);
  },
);

it.each(diagnosticEntrypoints)(
  "propagates the exact synchronous sink failure through $name",
  ({ level, write }) => {
    const failure = new Error("Diagnostic sink failure");
    const sink = jest.spyOn(console, level).mockImplementation(() => {
      throw failure;
    });
    let completed = false;
    let caught: unknown;
    try {
      write("diagnostic");
      completed = true;
    } catch (error) {
      caught = error;
    }
    expect(completed).toBe(false);
    expect(caught).toBe(failure);
    expect(sink).toHaveBeenCalledTimes(1);
  },
);
