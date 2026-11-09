/**
 * The account, network and provider a send was started on. The PIN unlock
 * takes a second or two, so each screen captures this at the tap and asserts
 * it again after the unlock, before anything is signed or sent.
 *
 * Every field is read directly from the store: a cached computed value could
 * lag behind an in-place change.
 *
 * Usage:
 *   const context = captureSigningContext(qrlStore);
 *   ...unlock...
 *   context.assertUnchanged();
 */
import type { BlockchainSelection } from "@/utils/storage/storage";

interface SigningContextSource {
  activeAccount: { accountAddress: string };
  qrlConnection: { blockchain: BlockchainSelection };
  qrlInstance?: unknown;
}

export interface SigningContext {
  assertUnchanged: () => void;
}

export function captureSigningContext(
  store: SigningContextSource,
): SigningContext {
  const account = store.activeAccount.accountAddress;
  const blockchain = store.qrlConnection.blockchain;
  const provider = store.qrlInstance;
  return {
    assertUnchanged: () => {
      if (
        store.activeAccount.accountAddress !== account ||
        store.qrlConnection.blockchain !== blockchain ||
        store.qrlInstance !== provider
      ) {
        throw new Error("Wallet changed while preparing the transaction");
      }
    },
  };
}
