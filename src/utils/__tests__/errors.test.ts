import { getErrorMessage, getProviderErrorCode } from "../errors";
import {
  foreignErrorCases,
  malformedErrorMessages,
  providerError,
  providerErrorShapes,
} from "./errorFixtures";

it.each(foreignErrorCases)(
  "preserves the display message of $name",
  ({ create, message }) => {
    expect(getErrorMessage(create())).toBe(message);
  },
);

it("preserves messages from errors, strings and message-bearing objects", () => {
  expect(getErrorMessage(new Error("failure"))).toBe("failure");
  expect(getErrorMessage("failure")).toBe("failure");
  expect(getErrorMessage({ message: "rejected", code: 4001 })).toBe("rejected");
  expect(getErrorMessage(null)).toBe("null");
  expect(getErrorMessage(42)).toBe("42");
});

it.each(malformedErrorMessages)(
  "formats malformed Error.message as $text",
  ({ value, text }) => {
    expect(
      getErrorMessage(
        Object.defineProperty(new Error(), "message", { value }),
      ),
    ).toBe(text);
  },
);

it.each(providerErrorShapes)(
  "preserves numeric codes and messages for $name",
  (shape) => {
    expect(getProviderErrorCode(providerError(shape, 4001, "failure"))).toBe(4001);
    expect(getErrorMessage(providerError(shape, -32601, "failure"))).toBe("failure");
  },
);

describe.each(providerErrorShapes)("$name provider errors", (shape) => {
  it.each([4001, -32601, -32000, 0, NaN, Infinity])(
    "preserves numeric code %s on a data property",
    (code) => {
      expect(getProviderErrorCode(providerError(shape, code, "failure"))).toBe(code);
    },
  );
});

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
    Object.assign(() => undefined, { code: 4001, message: "failure" }),
  ])
    expect(getProviderErrorCode(value)).toBeUndefined();
});
