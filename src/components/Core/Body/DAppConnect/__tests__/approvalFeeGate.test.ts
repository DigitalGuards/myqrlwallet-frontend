/**
 * @jest-environment jsdom
 *
 * Approving only a fee the user was actually shown.
 *
 * Approve used to stay enabled while the fee preview was loading or after it
 * failed, and the signing guard accepted a missing approved quote, so an RPC
 * answer that arrived later could be signed at a price that was never on
 * screen. A queued dApp request is also promoted the instant the previous one
 * is answered, so a preview has to belong to the request it is shown with.
 */
import { describe, expect, it } from "@jest/globals";
import {
  approvedFeeForRequest,
  isFeeApprovalPending,
  type FeePreviewState,
} from "../approvalFeeGate";

const quote = {
  maxFeePerGas: BigInt(100),
  maxPriorityFeePerGas: BigInt(10),
  expectedFeePerGas: BigInt(50),
  baseFeePerGas: BigInt(7),
};

const ready: FeePreviewState = {
  status: "ready",
  requestKey: "session-1:7",
  quote,
  gasLimit: BigInt(21_000),
  display: "0.0021 Quanta",
};

describe("the fee a dApp approval may sign against", () => {
  it("is the quote shown for this request", () => {
    expect(approvedFeeForRequest(ready, "session-1:7")).toEqual({
      quote,
      gasLimit: BigInt(21_000),
    });
  });

  it("is nothing while the quote is loading", () => {
    expect(
      approvedFeeForRequest(
        { status: "loading", requestKey: "session-1:7" },
        "session-1:7",
      ),
    ).toBeUndefined();
  });

  it("is nothing when the quote failed", () => {
    expect(
      approvedFeeForRequest(
        { status: "failed", requestKey: "session-1:7" },
        "session-1:7",
      ),
    ).toBeUndefined();
  });

  it("is nothing before any quote was attempted", () => {
    expect(approvedFeeForRequest(null, "session-1:7")).toBeUndefined();
  });

  it("is nothing when the preview belongs to the previous request", () => {
    // The queue promotes the next request as soon as this one is answered.
    expect(approvedFeeForRequest(ready, "session-1:8")).toBeUndefined();
  });

  it("is nothing when a ready preview is missing either half", () => {
    expect(
      approvedFeeForRequest({ ...ready, gasLimit: undefined }, "session-1:7"),
    ).toBeUndefined();
    expect(
      approvedFeeForRequest({ ...ready, quote: undefined }, "session-1:7"),
    ).toBeUndefined();
  });
});

describe("whether Approve has to wait", () => {
  const base = { isDesktop: false, isTransaction: true };

  it("waits while there is no approved fee", () => {
    expect(
      isFeeApprovalPending({ ...base, approvedFee: undefined }),
    ).toBe(true);
  });

  it("does not wait once the fee is on screen", () => {
    expect(
      isFeeApprovalPending({
        ...base,
        approvedFee: { quote, gasLimit: BigInt(21_000) },
      }),
    ).toBe(false);
  });

  it("does not wait for requests that carry no fee", () => {
    // qrl_requestAccounts, a signature, a chain switch: nothing to pay.
    expect(
      isFeeApprovalPending({
        ...base,
        isTransaction: false,
        approvedFee: undefined,
      }),
    ).toBe(false);
  });

  it("does not wait on desktop, where the signer shows the fee it signs", () => {
    expect(
      isFeeApprovalPending({
        ...base,
        isDesktop: true,
        approvedFee: undefined,
      }),
    ).toBe(false);
  });
});
