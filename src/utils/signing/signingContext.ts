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
import { toTemplateString } from "@/utils/guards";

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
  /**
   * Throws when a network read from storage differs from the captured one.
   * Storage is written before the store, so a switch can sit in storage while
   * the store still shows the old network. Call it right after each
   * `StorageUtil.getBlockChain()`, before the value is used.
   */
  assertNetwork: (selection: BlockchainSelection) => void;
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
  const capturedNetwork = toTemplateString(blockchain);
  return {
    assertNetwork: (selection) => {
      if (toTemplateString(selection) !== capturedNetwork) {
        throw new Error(message);
      }
    },
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
