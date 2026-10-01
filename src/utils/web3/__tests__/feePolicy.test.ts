import { describe, expect, it } from "@jest/globals";
import {
  ABSOLUTE_MAX_FEE_PER_GAS,
  ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS,
  FeeCeilingExceededError,
  FeeNotApprovedError,
  FeeQuoteIncreasedError,
  FeeQuoteOutOfPolicyError,
  MIN_TIP_ALLOWANCE,
  assertFeeQuoteWithinPolicy,
  assertQuoteNotAboveApproved,
  assertSignedFeeWithinApproved,
  feeQuoteViolation,
} from "@/utils/web3/feePolicy";

const GPLANCK = BigInt(1_000_000_000);

/** What the devnet actually looks like: a few planck of base fee. */
const ordinary = {
  baseFeePerGas: BigInt(7),
  maxPriorityFeePerGas: BigInt(1_500_000_000),
  maxFeePerGas: BigInt(1_500_000_014),
};

/**
 * The v3 devnet as measured on 2026-09-30 through the wallet's RPC proxy:
 * latest baseFeePerGas 0x7, qrl_maxPriorityFeePerGas 0x5e8de4ff. An earlier
 * floor of 2 Gplanck refused the default fee level and above against exactly
 * these numbers, so they are pinned here.
 */
const LIVE_BASE_FEE = BigInt(7);
const LIVE_SUGGESTED_TIP = BigInt(1_586_357_503);
/** src/stores/qrlStore.ts TIP_MULTIPLIERS, in percent. */
const TIP_MULTIPLIERS = { low: BigInt(100), medium: BigInt(150), high: BigInt(200) };

/** The quote quoteFees builds from a suggestion and a base fee. */
const walletQuote = (suggestedTip: bigint, baseFeePerGas: bigint, level: keyof typeof TIP_MULTIPLIERS) => {
  const maxPriorityFeePerGas = (suggestedTip * TIP_MULTIPLIERS[level]) / BigInt(100);
  return {
    baseFeePerGas,
    maxPriorityFeePerGas,
    maxFeePerGas: BigInt(2) * baseFeePerGas + maxPriorityFeePerGas,
  };
};

describe("the live devnet is not refused", () => {
  it.each(["low", "medium", "high"] as const)(
    "accepts today's quote at %s",
    (level) => {
      const quote = walletQuote(LIVE_SUGGESTED_TIP, LIVE_BASE_FEE, level);
      expect(feeQuoteViolation(quote)).toBeNull();
    },
  );

  it("accepts the medium tip that was signed on device", () => {
    // 2.379536268 Gplanck, the gas price of the transfer confirmed on chain.
    const quote = walletQuote(LIVE_SUGGESTED_TIP, LIVE_BASE_FEE, "medium");
    expect(quote.maxPriorityFeePerGas).toBe(BigInt(2_379_536_254));
    expect(feeQuoteViolation(quote)).toBeNull();
  });

  it.each(["low", "medium", "high"] as const)(
    "still accepts %s if the network's suggestion rises tenfold",
    (level) => {
      const quote = walletQuote(LIVE_SUGGESTED_TIP * BigInt(10), LIVE_BASE_FEE, level);
      expect(feeQuoteViolation(quote)).toBeNull();
    },
  );

  it("refuses a suggestion a hundred times today's, which is an attack", () => {
    const quote = walletQuote(LIVE_SUGGESTED_TIP * BigInt(100), LIVE_BASE_FEE, "medium");
    expect(feeQuoteViolation(quote)).toMatch(/the allowance at a base fee/);
  });
});

describe("the surfaces that share this policy", () => {
  it("accepts a dApp approval quote, which is always the medium level", () => {
    // DAppApprovalModal quotes at DAPP_FEE_LEVEL = "medium", both for the fee
    // shown before the user decides and for the one it signs. That path runs
    // on web, on the embedded document and on desktop.
    const quote = walletQuote(LIVE_SUGGESTED_TIP, LIVE_BASE_FEE, "medium");
    expect(feeQuoteViolation(quote)).toBeNull();
  });

  it("bounds the legacy gasPrice fallback by the absolute ceilings alone", () => {
    // applyFeeLevel builds from qrl_gasPrice, which already includes the base
    // fee and reports none separately, so there is nothing to compare
    // against. The absolute ceilings are the only bound, deliberately: nodes
    // that do not serve the fee market would otherwise be refused outright.
    const legacy = (maxFeePerGas: bigint, maxPriorityFeePerGas: bigint) => ({
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    // Far above any relative allowance, accepted because no base fee is known.
    expect(
      feeQuoteViolation(legacy(BigInt(900) * GPLANCK, BigInt(900) * GPLANCK)),
    ).toBeNull();
    // The absolute ceiling still bites.
    expect(
      feeQuoteViolation(
        legacy(
          ABSOLUTE_MAX_FEE_PER_GAS + BigInt(1),
          ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS + BigInt(1),
        ),
      ),
    ).toMatch(/exceeds the absolute ceiling/);
  });
});

describe("the maximum-fee rule never refuses a quote the tip rule allowed", () => {
  // allowance = 10 * base + tipAllowance, quote = 2 * base + tip, and the tip
  // has already been established as within both tip limits. At a very high
  // base fee the absolute tip ceiling is what binds, which is intended, so the
  // largest permitted tip is the smaller of the two.
  it.each([
    [BigInt(0)],
    [LIVE_BASE_FEE],
    [BigInt(120) * GPLANCK],
    [BigInt(900) * GPLANCK],
  ])("holds at a base fee of %s", (baseFeePerGas) => {
    const relative = baseFeePerGas * BigInt(20);
    const tipAllowance = relative > MIN_TIP_ALLOWANCE ? relative : MIN_TIP_ALLOWANCE;
    const largestPermittedTip =
      tipAllowance < ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS
        ? tipAllowance
        : ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS;
    const atTheLimit = {
      baseFeePerGas,
      maxPriorityFeePerGas: largestPermittedTip,
      maxFeePerGas: BigInt(2) * baseFeePerGas + largestPermittedTip,
    };
    expect(feeQuoteViolation(atTheLimit)).toBeNull();
  });
});

describe("ordinary quotes pass", () => {
  it("accepts a quote shaped like the wallet's own", () => {
    expect(feeQuoteViolation(ordinary)).toBeNull();
    expect(() => assertFeeQuoteWithinPolicy(ordinary)).not.toThrow();
  });

  it("accepts a busy network, where the base fee carries the cost", () => {
    const base = BigInt(120) * GPLANCK;
    expect(
      feeQuoteViolation({
        baseFeePerGas: base,
        maxPriorityFeePerGas: BigInt(4) * GPLANCK,
        maxFeePerGas: BigInt(2) * base + BigInt(4) * GPLANCK,
      }),
    ).toBeNull();
  });

  it("accepts a legacy quote with no base fee", () => {
    expect(
      feeQuoteViolation({
        maxPriorityFeePerGas: BigInt(2) * GPLANCK,
        maxFeePerGas: BigInt(3) * GPLANCK,
      }),
    ).toBeNull();
  });
});

describe("the tip is the lever, so it is bounded", () => {
  it("refuses a tip far above the base fee", () => {
    // The attack: a normal-looking quote on screen, a huge tip at signing.
    const violation = feeQuoteViolation({
      baseFeePerGas: BigInt(7),
      maxPriorityFeePerGas: BigInt(900) * GPLANCK,
      maxFeePerGas: BigInt(900) * GPLANCK,
    });
    expect(violation).toMatch(/above .*the allowance at a base fee/);
  });

  it("refuses a tip above the absolute ceiling even on a busy chain", () => {
    // A high base fee would satisfy the relative rule on its own, so the
    // absolute ceiling is what stops this one.
    const base = BigInt(1_000) * GPLANCK;
    const violation = feeQuoteViolation({
      baseFeePerGas: base,
      maxPriorityFeePerGas: ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS + BigInt(1),
      maxFeePerGas: ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS + BigInt(1),
    });
    expect(violation).toMatch(/exceeds the absolute ceiling/);
  });

  it("refuses a maximum fee above the absolute ceiling", () => {
    const violation = feeQuoteViolation({
      baseFeePerGas: BigInt(5_000) * GPLANCK,
      maxPriorityFeePerGas: BigInt(1),
      maxFeePerGas: ABSOLUTE_MAX_FEE_PER_GAS + BigInt(1),
    });
    expect(violation).toMatch(/maximum fee .* exceeds the absolute ceiling/);
  });

  it("still allows an ordinary tip when the base fee is near zero", () => {
    // A purely relative rule would refuse every real tip on a quiet chain,
    // which is exactly the regression this floor exists to prevent.
    expect(
      feeQuoteViolation({
        baseFeePerGas: BigInt(1),
        maxPriorityFeePerGas: MIN_TIP_ALLOWANCE,
        maxFeePerGas: MIN_TIP_ALLOWANCE + BigInt(2),
      }),
    ).toBeNull();
  });

  it("refuses one planck above the floor when the base fee is near zero", () => {
    expect(
      feeQuoteViolation({
        baseFeePerGas: BigInt(1),
        maxPriorityFeePerGas: MIN_TIP_ALLOWANCE + BigInt(1),
        maxFeePerGas: MIN_TIP_ALLOWANCE + BigInt(3),
      }),
    ).toMatch(/the allowance at a base fee/);
  });

  it("refuses nonsense", () => {
    expect(
      feeQuoteViolation({
        maxPriorityFeePerGas: BigInt(10),
        maxFeePerGas: BigInt(5),
      }),
    ).toBe("the tip is above the maximum fee");
    expect(
      feeQuoteViolation({
        maxPriorityFeePerGas: BigInt(-1),
        maxFeePerGas: BigInt(5),
      }),
    ).toBe("a fee is negative");
  });

  it("throws a message a user can act on", () => {
    expect(() =>
      assertFeeQuoteWithinPolicy({
        baseFeePerGas: BigInt(7),
        maxPriorityFeePerGas: ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS * BigInt(2),
        maxFeePerGas: ABSOLUTE_MAX_FEE_PER_GAS * BigInt(2),
      }),
    ).toThrow(FeeQuoteOutOfPolicyError);
  });
});

describe("signing the fee the user saw", () => {
  const approved = { maxFeePerGas: BigInt(100), maxPriorityFeePerGas: BigInt(10) };

  it("allows the same quote", () => {
    expect(() => assertQuoteNotAboveApproved(approved, approved)).not.toThrow();
  });

  it("allows a cheaper re-quote", () => {
    expect(() =>
      assertQuoteNotAboveApproved(
        { maxFeePerGas: BigInt(60), maxPriorityFeePerGas: BigInt(5) },
        approved,
      ),
    ).not.toThrow();
  });

  it("refuses a re-quote that grew, by any amount", () => {
    expect(() =>
      assertQuoteNotAboveApproved(
        { maxFeePerGas: BigInt(101), maxPriorityFeePerGas: BigInt(10) },
        approved,
      ),
    ).toThrow(FeeQuoteIncreasedError);
  });

  it("carries both figures, so the caller can show the new one", () => {
    try {
      assertQuoteNotAboveApproved(
        { maxFeePerGas: BigInt(500), maxPriorityFeePerGas: BigInt(400) },
        approved,
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FeeQuoteIncreasedError);
      const increased = error as FeeQuoteIncreasedError;
      expect(increased.approvedMaxFeePerGas).toBe(BigInt(100));
      expect(increased.currentMaxFeePerGas).toBe(BigInt(500));
    }
  });

  it("refuses to sign when the user was shown no quote at all", () => {
    // This used to sign whatever came back. A screen whose fee preview was
    // still loading, or had failed, could therefore produce a signature at a
    // price that was never displayed.
    expect(() =>
      assertQuoteNotAboveApproved(
        { maxFeePerGas: BigInt(10_000), maxPriorityFeePerGas: BigInt(9_000) },
        undefined,
      ),
    ).toThrow(FeeNotApprovedError);
  });
});

describe("signing no more than the total the user saw", () => {
  // The figure on screen is gas times price. Guarding only the price leaves
  // the other half of that product free to move.
  const quote = { maxFeePerGas: BigInt(100), maxPriorityFeePerGas: BigInt(10) };
  const approved = { quote, gasLimit: BigInt(21_000) };

  it("allows the same gas limit and price", () => {
    expect(() =>
      assertSignedFeeWithinApproved({ quote, gasLimit: BigInt(21_000) }, approved),
    ).not.toThrow();
  });

  it("refuses a gas limit that grew at an unchanged price", () => {
    // The exact gap: a tenfold re-estimate passed the price check untouched
    // and signed ten times the fee that was displayed.
    expect(() =>
      assertSignedFeeWithinApproved(
        { quote, gasLimit: BigInt(210_000) },
        approved,
      ),
    ).toThrow(FeeCeilingExceededError);
  });

  it("refuses one more unit of gas than was displayed", () => {
    expect(() =>
      assertSignedFeeWithinApproved(
        { quote, gasLimit: BigInt(21_001) },
        approved,
      ),
    ).toThrow(FeeCeilingExceededError);
  });

  it("lets a cheaper price pay for more gas, up to the same total", () => {
    // The ceiling is the product, so a price that halved can cover twice the
    // gas and the user still pays no more than the figure they approved.
    expect(() =>
      assertSignedFeeWithinApproved(
        {
          quote: { maxFeePerGas: BigInt(50), maxPriorityFeePerGas: BigInt(5) },
          gasLimit: BigInt(42_000),
        },
        approved,
      ),
    ).not.toThrow();
    expect(() =>
      assertSignedFeeWithinApproved(
        {
          quote: { maxFeePerGas: BigInt(50), maxPriorityFeePerGas: BigInt(5) },
          gasLimit: BigInt(42_001),
        },
        approved,
      ),
    ).toThrow(FeeCeilingExceededError);
  });

  it("still refuses a dearer price at the approved gas limit", () => {
    expect(() =>
      assertSignedFeeWithinApproved(
        {
          quote: { maxFeePerGas: BigInt(101), maxPriorityFeePerGas: BigInt(10) },
          gasLimit: BigInt(21_000),
        },
        approved,
      ),
    ).toThrow(FeeQuoteIncreasedError);
  });

  it("carries both totals, so the caller can show the new one", () => {
    try {
      assertSignedFeeWithinApproved(
        { quote, gasLimit: BigInt(210_000) },
        approved,
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FeeCeilingExceededError);
      const exceeded = error as FeeCeilingExceededError;
      expect(exceeded.approvedTotal).toBe(BigInt(2_100_000));
      expect(exceeded.currentTotal).toBe(BigInt(21_000_000));
    }
  });

  it("fails closed with no approved fee", () => {
    expect(() =>
      assertSignedFeeWithinApproved({ quote, gasLimit: BigInt(21_000) }, undefined),
    ).toThrow(FeeNotApprovedError);
  });
});
