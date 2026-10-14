import { afterEach, expect, it, jest } from "@jest/globals";
import log, { logger, logError, logInfo, logWarning } from "../log";

afterEach(() => {
  jest.restoreAllMocks();
});

it.each(["log", "warn", "error"] as const)(
  "preserves %s severity and diagnostic arguments",
  (level) => {
    const sink = jest.spyOn(console, level).mockImplementation(() => undefined);
    const error = new Error("Failure detail");
    logger[level]("Message:", error, 42);
    expect(sink).toHaveBeenCalledWith("Message:", error, 42);
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
