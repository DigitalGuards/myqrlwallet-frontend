/**
 * Input rules for the token creation form. Everything entered here is written
 * into an immutable contract, so input is validated as typed and never
 * rewritten into a different value.
 */

export const TOKEN_NAME_MAX = 50;
export const TOKEN_SYMBOL_MAX = 11;
export const TOKEN_DECIMALS_MAX = 18;
const MAX_UINT256 = 2n ** 256n - 1n;

/** Up to 50 characters, none of them control, format (bidi or zero-width) or unassigned. */
export function isValidTokenName(name: string): boolean {
  const characters = Array.from(name);
  return (
    characters.length >= 1 &&
    characters.length <= TOKEN_NAME_MAX &&
    !/\p{C}/u.test(name)
  );
}

/** One to eleven ASCII letters or digits. */
export function isValidTokenSymbol(symbol: string): boolean {
  return new RegExp(`^[A-Za-z0-9]{1,${String(TOKEN_SYMBOL_MAX)}}$`).test(symbol);
}

/** The decimals as a number when the text is a whole number from 1 to 18. */
export function tokenDecimals(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= TOKEN_DECIMALS_MAX ? value : null;
}

export type TokenAmount =
  | { ok: true; units: bigint }
  | { ok: false; reason: "format" | "precision" | "range" };

/**
 * Parses a plain decimal amount ("1000", "0.5") into the token's smallest
 * units. Signs, exponents, grouping separators and spaces inside the number
 * are rejected, as are more fractional digits than the token has decimals
 * and values above uint256.
 */
export function parseTokenAmount(text: string, decimals: number): TokenAmount {
  const trimmed = text.trim();
  // uint256 has 78 digits; anything much longer is out of range unparsed.
  if (trimmed.length > 100) return { ok: false, reason: "range" };
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return { ok: false, reason: "format" };
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return { ok: false, reason: "precision" };
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (units > MAX_UINT256) return { ok: false, reason: "range" };
  return { ok: true, units };
}
