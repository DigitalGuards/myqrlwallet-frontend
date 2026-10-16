import { NATIVE_TOKEN } from "@/constants";
import { BigNumber } from "bignumber.js";
import { formatBalance, formatQuantaValue } from "../balance";

it.each([undefined, null, ""])("formats an absent value %p as zero", (value) => {
  expect(formatQuantaValue(value)).toBe(`0 ${NATIVE_TOKEN.symbol}`);
});

const planckInputs: { name: string; value: unknown; quanta: string }[] = [
  { name: "whitespace", value: "  ", quanta: "0" },
  { name: "hexadecimal zero", value: "0x0", quanta: "0" },
  { name: "padded hexadecimal zero", value: "0x00", quanta: "0" },
  { name: "zero string", value: "0", quanta: "0" },
  { name: "zero number", value: 0, quanta: "0" },
  { name: "zero bigint", value: 0n, quanta: "0" },
  { name: "decimal string", value: "1000000000000000000", quanta: "1" },
  { name: "hexadecimal string", value: "0xde0b6b3a7640000", quanta: "1" },
  { name: "number", value: 1000000000000000000, quanta: "1" },
  { name: "bigint", value: 1000000000000000000n, quanta: "1" },
  { name: "integer ending in zeros", value: 1000000000000000000000n, quanta: "1000" },
  { name: "fraction with trailing zeros", value: 1230000000000000000n, quanta: "1.23" },
  { name: "single planck", value: 1n, quanta: "0.000000000000000001" },
  {
    name: "large bigint",
    value: 123456789012345678901234567890n,
    quanta: "123456789012.34567890123456789",
  },
  { name: "true", value: true, quanta: "0.000000000000000001" },
  { name: "false", value: false, quanta: "0" },
  { name: "BigNumber", value: new BigNumber("1000000000000000000"), quanta: "1" },
  { name: "boxed bigint", value: Object(1000000000000000000n), quanta: "1" },
  { name: "boxed string", value: Object("1000000000000000000"), quanta: "1" },
  { name: "boxed number", value: Object(1000000000000000000), quanta: "1" },
  { name: "boxed boolean", value: Object(true), quanta: "0.000000000000000001" },
  { name: "empty array", value: [], quanta: "0" },
  { name: "string array", value: ["1000000000000000000"], quanta: "1" },
  { name: "bigint array", value: [1000000000000000000n], quanta: "1" },
  { name: "nested array", value: [["1000000000000000000"]], quanta: "1" },
  { name: "typed array", value: new BigInt64Array([1000000000000000000n]), quanta: "1" },
  { name: "date", value: new Date(1234567890), quanta: "0.00000000123456789" },
  { name: "valueOf object", value: { valueOf: () => 1000000000000000000n }, quanta: "1" },
  { name: "toString object", value: { toString: () => "1000000000000000000" }, quanta: "1" },
  {
    name: "callable object",
    value: Object.assign(() => undefined, { valueOf: () => 1000000000000000000n }),
    quanta: "1",
  },
];

it.each(planckInputs)("formats $name planck values as $quanta", ({ value, quanta }) => {
  expect(formatQuantaValue(value)).toBe(`${quanta} ${NATIVE_TOKEN.symbol}`);
});

const invalidPlanckInputs: { name: string; value: unknown }[] = [
  { name: "negative number", value: -1 },
  { name: "negative bigint", value: -1n },
  { name: "negative string", value: "-1" },
  { name: "negative BigNumber", value: new BigNumber(-1) },
  { name: "fractional number", value: 1.5 },
  { name: "fractional BigNumber", value: new BigNumber("1.5") },
  { name: "NaN", value: NaN },
  { name: "infinity", value: Infinity },
  { name: "invalid string", value: "invalid" },
  { name: "multiple elements", value: [1, 2] },
  { name: "plain object", value: {} },
  { name: "symbol", value: Symbol("value") },
  { name: "boxed symbol", value: Object(Symbol("value")) },
  { name: "null prototype", value: Object.create(null) },
];

it.each(invalidPlanckInputs)("rejects $name planck values", ({ value }) => {
  expect(formatQuantaValue(value)).toBe("invalid value");
});

it.each([
  ["0", 0, "0"],
  ["0", 2, "0.00"],
  ["0.240000", 0, "0.24"],
  ["0.240000", 2, "0.24"],
  ["1000", 0, "1,000"],
  ["1000", 2, "1,000.00"],
  ["0.000000001", 0, "0.000000001"],
])("formats %s with %i minimum decimals as %s", (value, decimals, expected) => {
  expect(formatBalance(value, decimals)).toBe(expected);
});
