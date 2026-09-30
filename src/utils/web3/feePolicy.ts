/**
 * Safety limits on network fees.
 *
 * Every fee the wallet signs comes from the node behind the RPC proxy:
 * `qrl_maxPriorityFeePerGas`, the latest block's base fee, and `qrl_gasPrice`
 * as the fallback. None of it was bounded. A proxy that answers normally while
 * the send screen is open and with a huge tip at signing time gets the user to
 * sign away their balance as a tip, and the wallet re-quoted at signing, so
 * the signed fee never had to match the one displayed.
 *
 * The base fee is not the lever: its unused headroom is refunded, so inflating
 * it costs the sender nothing. The tip is paid in full, so that is what these
 * limits are mostly about.
 *
 * Two independent checks, because either alone has a blind spot:
 *
 *   - Relative to the base fee, which tracks real network conditions. A tip
 *     many times the base fee is not a busy network, it is someone asking for
 *     the balance.
 *   - Absolute, because on a quiet chain the base fee is near zero and any
 *     multiple of it is still near zero, which would let an attacker through
 *     under the relative rule alone.
 *
 * Amounts are in planck, the smallest unit. 1 Gplanck is 1e9 planck, the same
 * scale a gwei has against wei, so the numbers below read the way gas prices
 * usually do.
 */

const GPLANCK = BigInt(1_000_000_000);

/**
 * A tip above this multiple of the base fee is refused. Honest quotes sit
 * around one to two times the node's suggestion, and `quoteFees` scales that
 * by at most 2 for the fast level, so 20 leaves a wide margin over anything
 * congestion produces.
 */
export const MAX_TIP_OVER_BASE_FEE = BigInt(20);

/**
 * The tip allowance never drops below this, so a chain with a near-zero base
 * fee can still pay an ordinary tip. 2 Gplanck is generous next to the single
 * digits of planck the devnet suggests.
 */
export const MIN_TIP_ALLOWANCE = BigInt(2) * GPLANCK;

/**
 * `quoteFees` asks for `2 * baseFee + tip` so several base-fee rises fit
 * inside the ceiling. 10 leaves room for that headroom to grow without
 * letting the ceiling become a second way to overpay.
 */
export const MAX_FEE_OVER_BASE_FEE = BigInt(10);

/**
 * Absolute ceilings. At the 21,000 gas of a native transfer, a tip of
 * 1,000 Gplanck is 2.1e16 planck and a max fee of 10,000 Gplanck is 2.1e17
 * planck, so a single transaction can never cost more than a fraction of a
 * Quanta however the node answers. They are far above anything this network
 * produces and exist to bound the worst case, not to price transactions.
 */
export const ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS = BigInt(1_000) * GPLANCK;
export const ABSOLUTE_MAX_FEE_PER_GAS = BigInt(10_000) * GPLANCK;

/** The part of a fee quote these limits apply to. */
export interface FeeQuoteLimits {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  /** Absent when the quote came from the legacy `qrl_gasPrice` fallback. */
  readonly baseFeePerGas?: bigint | undefined;
}

export class FeeQuoteOutOfPolicyError extends Error {
  constructor(readonly reason: string) {
    super(
      "The network fee quoted for this transaction is far above what this " +
        "network normally charges, so the wallet stopped. Try again in a " +
        "moment, and tell us if it keeps happening.",
    );
    this.name = "FeeQuoteOutOfPolicyError";
  }
}

/** Why a quote is out of policy, or null when it is acceptable. */
export function feeQuoteViolation(quote: FeeQuoteLimits): string | null {
  if (quote.maxPriorityFeePerGas < BigInt(0) || quote.maxFeePerGas < BigInt(0)) {
    return "a fee is negative";
  }
  if (quote.maxPriorityFeePerGas > quote.maxFeePerGas) {
    return "the tip is above the maximum fee";
  }
  if (quote.maxPriorityFeePerGas > ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS) {
    return `the tip ${quote.maxPriorityFeePerGas} exceeds the absolute ceiling ${ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS}`;
  }
  if (quote.maxFeePerGas > ABSOLUTE_MAX_FEE_PER_GAS) {
    return `the maximum fee ${quote.maxFeePerGas} exceeds the absolute ceiling ${ABSOLUTE_MAX_FEE_PER_GAS}`;
  }

  const baseFee = quote.baseFeePerGas;
  if (baseFee === undefined) return null;

  const tipAllowance = (() => {
    const relative = baseFee * MAX_TIP_OVER_BASE_FEE;
    return relative > MIN_TIP_ALLOWANCE ? relative : MIN_TIP_ALLOWANCE;
  })();
  if (quote.maxPriorityFeePerGas > tipAllowance) {
    return `the tip ${quote.maxPriorityFeePerGas} is above ${tipAllowance}, the allowance at a base fee of ${baseFee}`;
  }
  const feeAllowance = baseFee * MAX_FEE_OVER_BASE_FEE + tipAllowance;
  if (quote.maxFeePerGas > feeAllowance) {
    return `the maximum fee ${quote.maxFeePerGas} is above ${feeAllowance}, the allowance at a base fee of ${baseFee}`;
  }
  return null;
}

/** Throw unless the quote is within policy. */
export function assertFeeQuoteWithinPolicy(quote: FeeQuoteLimits): void {
  const violation = feeQuoteViolation(quote);
  if (violation !== null) throw new FeeQuoteOutOfPolicyError(violation);
}

export class FeeQuoteIncreasedError extends Error {
  constructor(
    readonly approvedMaxFeePerGas: bigint,
    readonly currentMaxFeePerGas: bigint,
  ) {
    super(
      "The network fee rose while this transaction was being confirmed, so " +
        "nothing was signed. Check the new fee and send again.",
    );
    this.name = "FeeQuoteIncreasedError";
  }
}

/**
 * Refuse to sign a fee higher than the one the user approved.
 *
 * The fee is re-quoted at signing time, so without this the signed maximum can
 * differ from the figure on screen. A quote that came back cheaper is fine and
 * is signed as quoted.
 */
export function assertQuoteNotAboveApproved(
  current: FeeQuoteLimits,
  approved: FeeQuoteLimits | undefined,
): void {
  if (approved === undefined) return;
  if (current.maxFeePerGas > approved.maxFeePerGas) {
    throw new FeeQuoteIncreasedError(
      approved.maxFeePerGas,
      current.maxFeePerGas,
    );
  }
}
