import { describe, expect, it } from "@jest/globals";
import {
  ABSOLUTE_MAX_FEE_PER_GAS,
  ABSOLUTE_MAX_PRIORITY_FEE_PER_GAS,
  FeeQuoteIncreasedError,
  FeeQuoteOutOfPolicyError,
  MIN_TIP_ALLOWANCE,
  assertFeeQuoteWithinPolicy,
  assertQuoteNotAboveApproved,
  feeQuoteViolation,
} from "@/utils/web3/feePolicy";

const GPLANCK = BigInt(1_000_000_000);

/** What the devnet actually looks like: a few planck of base fee. */
const ordinary = {
  baseFeePerGas: BigInt(7),
  maxPriorityFeePerGas: BigInt(1_500_000_000),
  maxFeePerGas: BigInt(1_500_000_014),
};

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
    // A purely relative rule would refuse every real tip on a quiet chain.
    expect(
      feeQuoteViolation({
        baseFeePerGas: BigInt(1),
        maxPriorityFeePerGas: MIN_TIP_ALLOWANCE,
        maxFeePerGas: MIN_TIP_ALLOWANCE + BigInt(2),
      }),
    ).toBeNull();
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

  it("does nothing when the user was shown no quote", () => {
    expect(() =>
      assertQuoteNotAboveApproved(
        { maxFeePerGas: BigInt(10_000), maxPriorityFeePerGas: BigInt(9_000) },
        undefined,
      ),
    ).not.toThrow();
  });
});
