import {
  renderValue,
  stringValue,
  stringAttribute,
  incrementStoredNumber,
  integerArgument,
  toNumber,
} from "../guards";

it("preserves supported React children without rewriting metadata", () => {
  const children = ["name", 12, 4n, false, null, undefined];
  expect(renderValue(children)).toBe(children);
  expect(() => renderValue({ localized: "name" })).toThrow(
    "Objects are not valid as a React child",
  );
});

it("keeps string-only consumers failing on numeric and object values", () => {
  expect(stringValue("12")).toBe("12");
  expect(() => stringValue(12)).toThrow(TypeError);
  expect(() => stringValue({ text: "12" })).toThrow(TypeError);
});

it.each([0, 12, 12n, "0x0c", "9007199254740993"])(
  "preserves the ABI integer value and type: %p",
  (value) => {
    expect(integerArgument(value)).toBe(value);
  },
);

it("preserves native numeric coercion including bigint rejection", () => {
  expect(toNumber("0x10")).toBe(16);
  expect(toNumber(null)).toBe(0);
  expect(toNumber(undefined)).toBeNaN();
  expect(Object.is(toNumber(-0), -0)).toBe(true);
  expect(() => toNumber(2n)).toThrow(TypeError);
  expect(() => toNumber({ valueOf: () => 2n })).toThrow(TypeError);
  expect(() => toNumber(Symbol("number"))).toThrow(TypeError);
});

it("preserves string concatenation and numeric addition for stored retry counts", () => {
  expect(incrementStoredNumber(2)).toBe(3);
  expect(incrementStoredNumber("2")).toBe("21");
  expect(incrementStoredNumber([2])).toBe("21");
  expect(incrementStoredNumber({})).toBe("[object Object]1");
  expect(incrementStoredNumber(false)).toBe(1);
});

it("keeps omitted HTML attributes separate from their fallback text", () => {
  expect(stringAttribute(false)).toBeUndefined();
  expect(stringAttribute(true)).toBeUndefined();
  expect(stringAttribute(null)).toBeUndefined();
  expect(stringAttribute(["A", "B"])).toBe("A,B");
  expect(stringAttribute(0)).toBe("0");
});
