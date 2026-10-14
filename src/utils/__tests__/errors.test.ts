import { getErrorMessage, getProviderErrorCode } from "../errors";
import {
  firstReadOnly,
  inspectedProviderError,
  malformedErrorMessages,
  opaqueErrorCases,
  providerErrorShapes,
} from "./errorFixtures";

it.each(opaqueErrorCases)(
  "reads $name without throwing",
  ({ create, message }) => {
    expect(getErrorMessage(create())).toBe(message);
  },
);

it.each(opaqueErrorCases)("classifies $name without throwing", ({ create }) => {
  expect(getProviderErrorCode(create())).toBeUndefined();
});

it("preserves messages from errors, strings and message-bearing objects", () => {
  expect(getErrorMessage(new Error("failure"))).toBe("failure");
  expect(getErrorMessage("failure")).toBe("failure");
  expect(getErrorMessage({ message: "rejected", code: 4001 })).toBe("rejected");
  expect(getErrorMessage(null)).toBe("null");
  expect(getErrorMessage(42)).toBe("42");
});

it.each(malformedErrorMessages)(
  "snapshots malformed Error.message as $text",
  ({ value, text }) => {
    const getter = jest
      .fn()
      .mockImplementationOnce(() => value)
      .mockImplementation(() => {
        throw new Error("Message expired");
      });
    expect(
      getErrorMessage(
        Object.defineProperty(new Error(), "message", { get: getter }),
      ),
    ).toBe(text);
    expect(getter).toHaveBeenCalledTimes(1);
  },
);

it.each(providerErrorShapes)(
  "snapshots each $name error field once",
  (shape) => {
    const codeError = inspectedProviderError(shape, firstReadOnly(4001), () => {
      throw new Error("Message was unnecessary");
    });
    expect(getProviderErrorCode(codeError.value)).toBe(4001);
    expect(codeError.reads).toEqual({ code: 1, message: 0 });

    const messageError = inspectedProviderError(
      shape,
      () => {
        throw new Error("Code was unnecessary");
      },
      firstReadOnly("failure"),
    );
    expect(getErrorMessage(messageError.value)).toBe("failure");
    expect(messageError.reads).toEqual({ code: 0, message: 1 });
  },
);

it("preserves numeric error codes independently of unrelated fields", () => {
  expect(getProviderErrorCode({ code: -32601, message: "unsupported" })).toBe(
    -32601,
  );
  expect(getProviderErrorCode({ code: 4001, message: {} })).toBe(4001);
  expect(getProviderErrorCode(Object.assign([], { code: 4001 }))).toBe(4001);
});

it("returns no code for absent or malformed numeric codes", () => {
  for (const value of [
    null,
    undefined,
    "failure",
    [],
    {},
    { code: "4001" },
    { message: 1 },
    { code: null },
    { code: {}, message: "failure" },
    new Error("failure"),
    { code: undefined, message: "rejected" },
  ])
    expect(getProviderErrorCode(value)).toBeUndefined();
});
