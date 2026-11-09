/**
 * The account, account source, network and provider a send was started on.
 * A screen captures it at the tap and asserts it after the PIN unlock; a store
 * captures it at method entry, before its first await, and asserts it before
 * each signing or broadcast call.
 *
 * Every field is read directly from the store: a cached computed value could
 * lag behind an in-place change. A screen also passes the account and network
 * its own render used. When those differ from the store, the capture throws at
 * once, which catches a tap made on a stale render.
 *
 * Usage:
 *   const context = captureSigningContext(qrlStore, {
 *     message: "Wallet changed while preparing the NFT transfer",
 *     account: accountAddress,
 *     blockchain,
 *   });
 *   ...unlock...
 *   context.assertUnchanged();
 */
import type { BlockchainSelection } from "@/utils/storage/storage";

interface SigningContextSource {
  activeAccount: { accountAddress: string };
  activeAccountSource: unknown;
  qrlConnection: { blockchain: BlockchainSelection };
  qrlInstance?: unknown;
}

export interface SigningContextOptions {
  /** The error thrown on a change: the wording the caller already maps. */
  message: string;
  /** The account and network the caller's own render used. */
  account?: string;
  blockchain?: BlockchainSelection;
}

export interface SigningContext {
  assertUnchanged: () => void;
}

export function captureSigningContext(
  store: SigningContextSource,
  options: SigningContextOptions,
): SigningContext {
  const { message } = options;
  const account = store.activeAccount.accountAddress;
  const source = store.activeAccountSource;
  const blockchain = store.qrlConnection.blockchain;
  const provider = store.qrlInstance;
  if (
    (options.account !== undefined && options.account !== account) ||
    (options.blockchain !== undefined && options.blockchain !== blockchain)
  ) {
    throw new Error(message);
  }
  return {
    assertUnchanged: () => {
      if (
        store.activeAccount.accountAddress !== account ||
        store.activeAccountSource !== source ||
        store.qrlConnection.blockchain !== blockchain ||
        store.qrlInstance !== provider
      ) {
        throw new Error(message);
      }
    },
  };
}
