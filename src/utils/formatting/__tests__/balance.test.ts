import { NATIVE_TOKEN } from "@/constants";
import { formatQuantaValue } from "../balance";

it("preserves supported primitive planck values", () => {
  for (const value of [undefined, null, ""]) {
    expect(formatQuantaValue(value)).toBe(`0 ${NATIVE_TOKEN.symbol}`);
  }
  for (const value of ["0", 0, 0n, false]) {
    expect(formatQuantaValue(value)).toBe(`0. ${NATIVE_TOKEN.symbol}`);
  }
  for (const value of [
    "1000000000000000000",
    1000000000000000000,
    1000000000000000000n,
    "0xde0b6b3a7640000",
  ]) {
    expect(formatQuantaValue(value)).toBe(`1 ${NATIVE_TOKEN.symbol}`);
  }
  expect(formatQuantaValue(true)).toBe(formatQuantaValue(1n));
});

it("rejects invalid numbers and strings", () => {
  for (const value of [-1, -1n, "-1", "abc", 1.5, NaN, Infinity]) {
    expect(formatQuantaValue(value)).toBe("invalid value");
  }
});

it("rejects objects and arrays without invoking coercion hooks", () => {
  const valueOf = jest.fn(() => 1000000000000000000n);
  const toString = jest.fn(() => "1000000000000000000");
  for (const value of [
    { valueOf },
    { toString },
    [],
    ["1"],
    {},
    Symbol("value"),
  ]) {
    expect(formatQuantaValue(value)).toBe("invalid value");
  }
  expect(valueOf).not.toHaveBeenCalled();
  expect(toString).not.toHaveBeenCalled();
});
