/**
 * ERC20 fixed-point unit conversion, drop-in compatible with ethers v6
 * `formatUnits` / `parseUnits`.
 *
 * These replace the only two `ethers` imports left in the app (token amount
 * display + transaction amount parsing). `ethers` was otherwise unused, and its
 * exact-pinned transitive `ws@8.17.1` was the sole reason the app needed a `ws`
 * dependency override; removing ethers lets `ws` resolve to a patched version
 * in-range with no override.
 *
 * Implemented on bignumber.js (already a dependency) with a self-contained
 * config clone, so behavior is exact and independent of any global
 * BigNumber.config() set elsewhere in the app.
 */
import { BigNumber } from "bignumber.js";

// EXPONENTIAL_AT high so large/small magnitudes never render in scientific
// notation; DECIMAL_PLACES high so no value is ever rounded.
const BN = BigNumber.clone({ EXPONENTIAL_AT: 1e9, DECIMAL_PLACES: 100 });

/**
 * Convert a base-unit integer amount to a human-readable decimal string.
 * Matches ethers v6: full precision, trailing zeros stripped, but always at
 * least one fractional digit (e.g. `1.0`).
 */
export function formatUnits(value: bigint | string | number, decimals: number = 18): string {
  const v = new BN(typeof value === "bigint" ? value.toString() : value);
  if (v.isNaN()) {
    throw new Error(`formatUnits: invalid value "${String(value)}"`);
  }
  let s = v.shiftedBy(-decimals).toFixed();
  // ethers keeps at least one fractional digit when decimals > 0 (e.g. "1.0"),
  // but renders a plain integer when decimals === 0 (e.g. "42").
  if (decimals > 0 && !s.includes(".")) {
    s += ".0";
  }
  return s;
}

/**
 * Convert a human-readable decimal string to a base-unit BigInt.
 * Matches ethers v6: throws on a non-numeric value or on more fractional
 * digits than `decimals` allows.
 */
export function parseUnits(value: string, decimals: number = 18): bigint {
  // Strict decimal-string validation. ethers v6 rejects non-decimal formats,
  // but bignumber.js silently parses hex/binary/octal prefixes (e.g. "0x11" ->
  // 17). For a transaction-amount parser that would be a dangerous mismatch, so
  // reject anything that is not an optionally-signed base-10 decimal here.
  if (typeof value !== 'string' || !/^-?(\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    throw new Error(`parseUnits: invalid decimal value "${value}"`);
  }
  const v = new BN(value.trim());
  if (v.isNaN()) {
    throw new Error(`parseUnits: invalid decimal value "${value}"`);
  }
  const scaled = v.shiftedBy(decimals);
  if (!scaled.isInteger()) {
    throw new Error(`parseUnits: "${value}" has more than ${decimals} decimal places`);
  }
  return BigInt(scaled.toFixed(0));
}
