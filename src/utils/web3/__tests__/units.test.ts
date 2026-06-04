/**
 * Coverage for the ethers-free fixed-point unit conversion (src/utils/web3/units.ts).
 * Expected values were verified byte-for-byte against ethers v6
 * formatUnits/parseUnits before ethers was removed from the project.
 */
import { formatUnits, parseUnits } from "../units";

describe("formatUnits (ethers v6 parity)", () => {
  it.each([
    [1500000n, 6, "1.5"],
    [1000000n, 6, "1.0"],
    [1230000n, 6, "1.23"],
    [0n, 18, "0.0"],
    [10n ** 18n, 18, "1.0"],
    [123456789012345678n, 18, "0.123456789012345678"],
    [999999999999999999n, 18, "0.999999999999999999"],
    [1n, 18, "0.000000000000000001"],
    [42n, 0, "42"],
    [1000000n, 0, "1000000"],
    [100000000n, 8, "1.0"],
  ])("formatUnits(%s, %s) = %s", (value, decimals, expected) => {
    expect(formatUnits(value, decimals)).toBe(expected);
  });

  it("accepts string and number inputs", () => {
    expect(formatUnits("1500000", 6)).toBe("1.5");
    expect(formatUnits(1500000, 6)).toBe("1.5");
  });

  it("throws on a non-numeric value", () => {
    expect(() => formatUnits("not-a-number", 6)).toThrow(/invalid value/);
  });
});

describe("parseUnits (ethers v6 parity)", () => {
  it.each([
    ["1.5", 6, 1500000n],
    ["1", 6, 1000000n],
    ["0.000001", 6, 1n],
    ["123.456", 18, 123456000000000000000n],
    ["0", 18, 0n],
    ["1000000", 0, 1000000n],
    ["999999999999.999999", 6, 999999999999999999n],
  ])("parseUnits(%s, %s) = %s", (value, decimals, expected) => {
    expect(parseUnits(value, decimals)).toBe(expected);
  });

  it("round-trips with formatUnits", () => {
    const raw = parseUnits("1234.567891", 8);
    expect(formatUnits(raw, 8)).toBe("1234.567891");
  });

  it("throws on more fractional digits than decimals allows", () => {
    expect(() => parseUnits("1.5", 0)).toThrow(/more than 0 decimal places/);
    expect(() => parseUnits("0.0000001", 6)).toThrow(/more than 6 decimal places/);
  });

  it("throws on a non-numeric value", () => {
    expect(() => parseUnits("abc", 6)).toThrow(/invalid decimal value/);
  });

  it("rejects non-decimal formats that bignumber.js would otherwise accept (ethers parity)", () => {
    // bignumber.js silently parses these; ethers v6 (and now we) reject them.
    expect(() => parseUnits("0x11", 6)).toThrow(/invalid decimal value/);
    expect(() => parseUnits("0b101", 6)).toThrow(/invalid decimal value/);
    expect(() => parseUnits("0o17", 6)).toThrow(/invalid decimal value/);
    expect(() => parseUnits("1e3", 6)).toThrow(/invalid decimal value/);
    expect(() => parseUnits("", 6)).toThrow(/invalid decimal value/);
    expect(() => parseUnits("1.2.3", 6)).toThrow(/invalid decimal value/);
    expect(() => parseUnits("  ", 6)).toThrow(/invalid decimal value/);
  });
});
