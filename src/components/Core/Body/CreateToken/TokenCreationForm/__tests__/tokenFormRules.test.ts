import {
  isValidTokenName,
  isValidTokenSymbol,
  parseTokenAmount,
  tokenDecimals,
} from "../tokenFormRules";

describe("isValidTokenName", () => {
  it.each(["A", "My QRL Token", "Ledger Integration test", "代币", "x".repeat(50)])(
    "accepts %p",
    (name) => {
      expect(isValidTokenName(name)).toBe(true);
    },
  );

  it.each([
    "",
    "x".repeat(51),
    "Token\u0000",
    "Line\nbreak",
    "Tab\tname",
    "Usd‮Treversed",
    "Zero​width",
    "Isolate⁦x⁩",
    "Bom﻿",
  ])("rejects %p", (name) => {
    expect(isValidTokenName(name)).toBe(false);
  });

  it("counts characters by code point", () => {
    expect(isValidTokenName("😀".repeat(50))).toBe(true);
    expect(isValidTokenName("😀".repeat(51))).toBe(false);
  });
});

describe("isValidTokenSymbol", () => {
  it.each(["Q", "MQW", "stQRL", "A1B2C3D4E5F"])("accepts %p", (symbol) => {
    expect(isValidTokenSymbol(symbol)).toBe(true);
  });

  it.each(["", "A1B2C3D4E5F6", "MQ W", "MQ-W", "MQW!", "МQW", "‮MQW"])(
    "rejects %p",
    (symbol) => {
      expect(isValidTokenSymbol(symbol)).toBe(false);
    },
  );
});

describe("tokenDecimals", () => {
  it.each([
    ["1", 1],
    ["18", 18],
    [" 8 ", 8],
  ])("reads %p as %p", (text, value) => {
    expect(tokenDecimals(text)).toBe(value);
  });

  it.each(["", "0", "19", "007", "1.5", "1e1", "-1", "abc", "7477474746464646"])(
    "rejects %p",
    (text) => {
      expect(tokenDecimals(text)).toBeNull();
    },
  );
});

describe("parseTokenAmount", () => {
  it.each([
    ["1000", 18, 1000n * 10n ** 18n],
    ["0", 18, 0n],
    ["0.5", 1, 5n],
    [" 12.34 ", 2, 1234n],
    ["1.10", 2, 110n],
  ])("parses %p with %p decimals", (text, decimals, units) => {
    expect(parseTokenAmount(text, decimals)).toEqual({ ok: true, units });
  });

  it.each([
    ["", "format"],
    ["1,000", "format"],
    ["1 000", "format"],
    ["1e5", "format"],
    ["-1", "format"],
    ["+1", "format"],
    [".5", "format"],
    ["5.", "format"],
    ["0x10", "format"],
    ["١٢", "format"],
    ["0.123", "precision"],
    ["9".repeat(101), "range"],
  ])("rejects %p as %p", (text, reason) => {
    expect(parseTokenAmount(text, 2)).toEqual({ ok: false, reason });
  });

  it("rejects values above uint256", () => {
    const max = 2n ** 256n - 1n;
    expect(parseTokenAmount(max.toString(), 0)).toEqual({ ok: true, units: max });
    expect(parseTokenAmount((max + 1n).toString(), 0)).toEqual({
      ok: false,
      reason: "range",
    });
    // 60 whole digits fit with 18 decimals; 61 do not.
    expect(parseTokenAmount("1".repeat(59), 18).ok).toBe(true);
    expect(parseTokenAmount("9".repeat(60), 18)).toEqual({ ok: false, reason: "range" });
  });
});
