import type { FeeQuote } from "@/stores/qrlStore";
import type { ApprovedFee } from "@/utils/web3/feePolicy";

/**
 * The fee preview for the request on screen, and how it is going.
 *
 * `requestKey` is what ties a quote to the request it was quoted for. A queued
 * dApp request is promoted the moment the previous one is answered, and the
 * previous preview is still in state for a render or two.
 */
export interface FeePreviewState {
  status: "loading" | "ready" | "failed";
  requestKey: string;
  quote?: FeeQuote;
  gasLimit?: bigint;
  display?: string;
}

/**
 * The fee this approval may be signed against, or undefined.
 *
 * Only a successful quote for THIS request counts. The signing guard fails
 * closed on undefined, so a preview that is loading, has failed, or belongs to
 * the request before this one can never become a signature.
 */
export function approvedFeeForRequest(
  preview: FeePreviewState | null,
  requestKey: string,
): ApprovedFee | undefined {
  if (preview === null || preview.status !== "ready") return undefined;
  if (preview.requestKey !== requestKey) return undefined;
  if (preview.quote === undefined || preview.gasLimit === undefined) {
    return undefined;
  }
  return { quote: preview.quote, gasLimit: preview.gasLimit };
}

/**
 * Whether Approve has to wait for a fee to appear.
 *
 * Approving a transaction with no fee on screen is approving a cost the user
 * was never shown, and a quote that lands later is then signed unseen. Desktop
 * is exempt: the isolated signer shows the fee it is about to sign in its own
 * trusted window, so a renderer that cannot quote must not block the approval.
 */
export function isFeeApprovalPending(input: {
  isDesktop: boolean;
  isTransaction: boolean;
  approvedFee: ApprovedFee | undefined;
}): boolean {
  if (input.isDesktop || !input.isTransaction) return false;
  return input.approvedFee === undefined;
}
