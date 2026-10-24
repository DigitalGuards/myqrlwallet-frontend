import { z } from "zod";
import { localTransactionSchema, parseHistoryResponse } from "@/utils/transactionHistory";
import { maxUtf16Length, minUtf16Length } from "@/utils/zodLength";

// One astral character is two UTF-16 code units and one code point.
const astral = "\u{1f600}";

describe("UTF-16 zod length checks", () => {
  const atLeastEight = z.string().superRefine(minUtf16Length(8, "too short"));
  const atMostFour = z.string().superRefine(maxUtf16Length(4));

  it("counts UTF-16 code units for the minimum", () => {
    expect(atLeastEight.safeParse(astral.repeat(4)).success).toBe(true);
    const rejected = atLeastEight.safeParse(astral.repeat(3) + "a");
    expect(rejected.success).toBe(false);
    expect(rejected.error?.issues).toEqual([
      expect.objectContaining({ code: "too_small", minimum: 8, message: "too short" }),
    ]);
  });

  it("counts UTF-16 code units for the maximum", () => {
    expect(atMostFour.safeParse(astral.repeat(2)).success).toBe(true);
    const rejected = atMostFour.safeParse(astral.repeat(2) + "a");
    expect(rejected.success).toBe(false);
    expect(rejected.error?.issues).toEqual([
      expect.objectContaining({ code: "too_big", maximum: 4 }),
    ]);
  });

  it("matches zod's own checks for ASCII text", () => {
    const zodMin = z.string().min(8);
    const zodMax = z.string().max(4);
    for (const value of ["", "abc", "abcd", "abcde", "abcdefg", "abcdefgh", "abcdefghi"]) {
      expect(atLeastEight.safeParse(value).success).toBe(zodMin.safeParse(value).success);
      expect(atMostFour.safeParse(value).success).toBe(zodMax.safeParse(value).success);
    }
  });
});

describe("PIN checks keep their first error", () => {
  const pin = z
    .string()
    .superRefine(minUtf16Length(4, "onboarding:pinMin"))
    .superRefine(maxUtf16Length(6, "onboarding:pinMax"))
    .regex(/^\d+$/, "onboarding:pinDigits");

  it("reports the digits rule first for a six-unit astral PIN", () => {
    const rejected = pin.safeParse(astral.repeat(3));
    expect(rejected.error?.issues[0]?.message).toBe("onboarding:pinDigits");
  });

  it("keeps the length errors for short and long PINs", () => {
    expect(pin.safeParse("123").error?.issues[0]?.message).toBe("onboarding:pinMin");
    expect(pin.safeParse("1234567").error?.issues[0]?.message).toBe("onboarding:pinMax");
    expect(pin.safeParse("1234").success).toBe(true);
  });
});

describe("transaction history keeps its UTF-16 caps", () => {
  const local = {
    blockchain: "TEST_NET_V3",
    from: `Q${"599f6618".repeat(16)}`,
    to: "",
    hash: `0x${"c".repeat(64)}`,
    amount: "1",
    asset: "QRL",
    submittedAt: 1,
    nonce: null,
    state: "pending",
    blockNumber: "",
    paidFees: null,
  };

  it("caps a local asset name at 100 code units", () => {
    expect(localTransactionSchema.safeParse({ ...local, asset: astral.repeat(50) }).success).toBe(
      true,
    );
    expect(
      localTransactionSchema.safeParse({ ...local, asset: astral.repeat(50) + "a" }).success,
    ).toBe(false);
  });

  it("caps history text fields at 512 code units", () => {
    const row = {
      ID: "1",
      InOut: 0,
      TxType: astral.repeat(256),
      Address: "a",
      From: "a",
      To: "a",
      TxHash: "0x1",
      TimeStamp: "1",
      Amount: "1",
      BlockNumber: "1",
    };
    expect(parseHistoryResponse({ transactions: [row] })).toHaveLength(1);
    expect(() =>
      parseHistoryResponse({ transactions: [{ ...row, TxType: astral.repeat(256) + "a" }] }),
    ).toThrow("Invalid transaction history response");
  });
});
