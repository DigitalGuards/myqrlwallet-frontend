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
 * fee can still pay an ordinary tip.
 *
 * The base fee and the suggested tip are on completely different scales here,
 * and conflating them is what made an earlier version of this file refuse
 * ordinary sends. On the v3 devnet the base fee is single digits of planck
 * while `qrl_maxPriorityFeePerGas` suggests about 1.59 Gplanck, which
 * `TIP_MULTIPLIERS` scales to roughly 1.59, 2.38 and 3.17 Gplanck for slow,
 * medium and fast. A floor of 2 Gplanck therefore refused the default level
 * and above, on a live network, which is why this is a fixed value with real
 * headroom rather than a number that looks small.
 *
 * 50 Gplanck is about 30 times today's suggestion. The tip is paid per gas
 * used, so at this floor the worst an unbounded node can extract while the
 * base fee is near zero is 0.00105 Quanta for a 21,000-gas transfer and about
 * 0.05 Quanta at a million gas.
 */
export const MIN_TIP_ALLOWANCE = BigInt(50) * GPLANCK;

/**
 * `quoteFees` asks for `2 * baseFee + tip` so several base-fee rises fit
 * inside the ceiling. 10 leaves room for that headroom to grow without
 * letting the ceiling become a second way to overpay.
 *
 * This rule can never be the one that refuses a wallet quote: the allowance is
 * `10 * baseFee + tipAllowance`, the quote is `2 * baseFee + tip`, and the tip
 * rule above has already established `tip <= tipAllowance`. A test pins that.
 */
export const MAX_FEE_OVER_BASE_FEE = BigInt(10);

/**
 * Absolute ceilings. At the 21,000 gas of a native transfer, a tip of
 * 1,000 Gplanck is 2.1e16 planck and a max fee of 10,000 Gplanck is 2.1e17
 * planck, so a single transaction can never cost more than a fraction of a
 * Quanta however the node answers. They are far above anything this network
 * produces and exist to bound the worst case rather than to price anything.
 *
 * These are also the only limits that apply to the legacy `qrl_gasPrice`
 * fallback, which reports no base fee, so there is nothing to compare against.
 * That is deliberate: the fallback exists for nodes that do not serve the fee
 * market, and refusing every such quote would break those networks outright.
 * The bound it leaves is the absolute ceiling, which at a million gas is about
 * one Quanta.
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

export class FeeNotApprovedError extends Error {
  constructor() {
    super(
      "The network fee for this transaction could not be shown, so nothing " +
        "was signed. Try again once the fee appears.",
    );
    this.name = "FeeNotApprovedError";
  }
}

export class FeeCeilingExceededError extends Error {
  constructor(
    readonly approvedTotal: bigint,
    readonly currentTotal: bigint,
  ) {
    super(
      "This transaction now needs more gas than the fee shown covered, so " +
        "nothing was signed. Check the new fee and send again.",
    );
    this.name = "FeeCeilingExceededError";
  }
}

/**
 * What the user was actually shown, and what it was computed from.
 *
 * The displayed figure is a product of two numbers, and guarding only the
 * price lets the other one move: a re-estimate that asks for ten times the gas
 * passes a price check unchanged and signs ten times the fee. Both halves
 * travel together so the total on screen is the thing being enforced.
 */
export interface ApprovedFee {
  /** The quote the figure on screen was computed from. */
  quote: FeeQuoteLimits;
  /** The gas limit that figure was computed with. */
  gasLimit: bigint;
}

/**
 * Refuse to sign a fee higher than the one the user approved.
 *
 * The fee is re-quoted at signing time, so without this the signed maximum can
 * differ from the figure on screen. A quote that came back cheaper is fine and
 * is signed as quoted.
 *
 * Fails closed when there is no approved quote. An absent one used to be read
 * as "nothing to compare against" and signed whatever came back, so a screen
 * that never managed to show a fee could still produce a signature.
 */
export function assertQuoteNotAboveApproved(
  current: FeeQuoteLimits,
  approved: FeeQuoteLimits | undefined,
): void {
  if (approved === undefined) throw new FeeNotApprovedError();
  if (current.maxFeePerGas > approved.maxFeePerGas) {
    throw new FeeQuoteIncreasedError(
      approved.maxFeePerGas,
      current.maxFeePerGas,
    );
  }
}

/**
 * A screen that shows no network fee has no figure to hold a signature to.
 *
 * Stated explicitly at every call site, so an omitted approval can never be
 * mistaken for a screen that genuinely displays nothing. The policy bounds in
 * this file still cap what such a send can cost.
 */
export const FEE_NOT_SHOWN = "fee-not-shown";
export type ApprovedFeeInput = ApprovedFee | typeof FEE_NOT_SHOWN;

/**
 * Refuse to sign more than the total the user approved.
 *
 * The displayed maximum is `gasLimit * maxFeePerGas`, and signing re-estimates
 * gas, so the price check alone leaves the gas side free to grow. This holds
 * the product: a cheaper price can absorb a larger gas limit, and anything
 * above the figure that was on screen stops and asks again.
 */
export function assertSignedFeeWithinApproved(
  signed: { quote: FeeQuoteLimits; gasLimit: bigint },
  approved: ApprovedFee | undefined,
): void {
  assertQuoteNotAboveApproved(signed.quote, approved?.quote);
  if (approved === undefined) throw new FeeNotApprovedError();
  if (signed.gasLimit < BigInt(0) || approved.gasLimit < BigInt(0)) {
    throw new FeeNotApprovedError();
  }
  const approvedTotal = approved.gasLimit * approved.quote.maxFeePerGas;
  const signedTotal = signed.gasLimit * signed.quote.maxFeePerGas;
  if (signedTotal > approvedTotal) {
    throw new FeeCeilingExceededError(approvedTotal, signedTotal);
  }
}
