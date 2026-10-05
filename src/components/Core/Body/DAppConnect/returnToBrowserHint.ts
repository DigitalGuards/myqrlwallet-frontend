import type { TxProgressState } from "@/stores/dappConnectStore";

/**
 * Whether the approval result should tell the user to switch back to their
 * browser.
 *
 * The app hands a same-device user back to the dApp after an answered request.
 * On Android it does that by backgrounding its own task, so the browser tab the
 * user came from returns by itself and there is nothing to say. iOS has no
 * public equivalent, so the wallet stays in front and the only thing left is to
 * tell the user, once the dApp actually has its answer.
 *
 * A pure decision, so the matrix is testable without rendering the approval
 * modal and its wallet dependencies.
 */
export function shouldPromptReturnToBrowser(input: {
  /** Inside the native app on iOS. */
  isIOSNative: boolean;
  txProgress: TxProgressState;
  /**
   * The answer reached the dApp and the app was asked to hand the user back.
   *
   * Not merely "this session would bounce": an answer held for an absent relay
   * has not arrived, and sending the user back to a dApp that is still waiting
   * is worse than saying nothing.
   */
  handedBackToDApp: boolean;
}): boolean {
  if (!input.isIOSNative || !input.handedBackToDApp) return false;
  // The dApp is answered when the node accepts the broadcast, which is
  // "confirming". Everything after that is the wallet's own progress, and
  // "unknown" still means the dApp holds a hash. A failure belongs on screen
  // here.
  return (
    input.txProgress === "confirming" ||
    input.txProgress === "confirmed" ||
    input.txProgress === "unknown"
  );
}
