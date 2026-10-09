import { isCallable, isRecord } from '@/utils/guards';
import { receiptExecutionStatus } from '@/utils/web3/txPolling';
import {
  UNKNOWN_BROADCAST_MESSAGE,
  isAlreadyKnown,
  isDefinitiveBroadcastRejection,
} from './dappBroadcastOutcome';

export interface DAppBroadcastEventSource {
  on(event: string, listener: (value: unknown) => void): unknown;
}

interface DAppBroadcastSettlementCallbacks {
  onTransactionHash(hash: string): void;
  onSuccess(hash: string): void;
  onFailure(error: string): void;
  onUnknown(hash: string, message: string): void;
}

function transactionHashFromReceipt(value: unknown): string {
  if (!isRecord(value)) return '';
  const hash = value['transactionHash'];
  if (typeof hash === 'string') return hash;
  if (hash instanceof Uint8Array) {
    return `0x${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return '';
}

export function getDAppReceiptStatus(receipt: unknown, transactionHash?: string): boolean | undefined {
  const hash = transactionHashFromReceipt(receipt);
  if (!hash || (transactionHash && hash.toLowerCase() !== transactionHash.toLowerCase())) return undefined;
  if (!isRecord(receipt)) return undefined;
  return receiptExecutionStatus(receipt['status']);
}

/**
 * PromiEvents may emit receipt followed by error for a reverted transaction.
 * This adapter owns one-shot settlement so one request can receive exactly one
 * approval or rejection, never both.
 */
export interface DAppBroadcastSettlementOptions {
  /**
   * The hash derived from the signed bytes, known before the broadcast.
   *
   * Used when the broadcast fails without the node having answered: the
   * transaction may be in the mempool, so the dApp gets the real hash and both
   * sides watch the chain, rather than being told the request failed and
   * sending it a second time.
   */
  localHash?: string | undefined;
}

export function waitForDAppBroadcastSettlement(
  source: unknown,
  callbacks: DAppBroadcastSettlementCallbacks,
  options: DAppBroadcastSettlementOptions = {},
): Promise<void> {
  if (!isEventSource(source)) {
    return Promise.reject(new Error('Invalid transaction event source'));
  }
  const eventSource = source;
  return new Promise((resolve) => {
    let settled = false;
    let broadcastHash = '';
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        callback();
      } finally {
        resolve();
      }
    };

    eventSource.on('transactionHash', (value) => {
      if (settled || typeof value !== 'string') return;
      broadcastHash = value;
      callbacks.onTransactionHash(value);
    });
    eventSource.on('receipt', (value) => {
      if (settled) return;
      const receipt = isRecord(value) ? value : null;
      const hash = transactionHashFromReceipt(receipt);
      const succeeded = getDAppReceiptStatus(receipt, broadcastHash);
      if (succeeded === undefined) {
        settle(() => { callbacks.onUnknown(broadcastHash || hash, 'Transaction confirmation is unavailable. Check the explorer before sending again.'); });
        return;
      }
      if (!succeeded) {
        settle(() => { callbacks.onFailure('Transaction has been reverted by the QRVM'); });
        return;
      }
      settle(() => { callbacks.onSuccess(hash); });
    });
    const failWithoutHash = (value: unknown): void => {
      const message = value instanceof Error ? value.message : String(value);
      const localHashForDuplicate = options.localHash;
      if (localHashForDuplicate && isAlreadyKnown(value)) {
        // The node already holds this transaction, so it is on its way. The
        // dApp gets the hash, the same answer the desktop signer gives.
        settle(() =>
          { callbacks.onUnknown(
            localHashForDuplicate,
            'This transaction is already in the network queue. Check the explorer before sending it again.',
          ); },
        );
        return;
      }
      if (isDefinitiveBroadcastRejection(value)) {
        // The node replied with an error, so nothing is in the mempool.
        settle(() => { callbacks.onFailure(message); });
        return;
      }
      const localHash = options.localHash;
      if (localHash) {
        // Nobody answered. The transaction may well have been accepted, so
        // the dApp gets the hash derived from the signed bytes instead of a
        // rejection it would act on by sending again.
        settle(() => { callbacks.onUnknown(localHash, UNKNOWN_BROADCAST_MESSAGE); });
        return;
      }
      settle(() => { callbacks.onFailure(message); });
    };

    eventSource.on('error', (value) => {
      if (broadcastHash) {
        settle(() => { callbacks.onUnknown(broadcastHash, 'Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.'); });
        return;
      }
      failWithoutHash(value);
    });

    // A transport failure rejects the PromiEvent without emitting `error`
    // (measured: fetch failed, abort, a proxy 5xx). Observed here so it
    // settles through the same one-shot path, and so it is never an unhandled
    // rejection.
    if (isPromiseLike(source)) {
      void source.then(
        () => undefined,
        (value: unknown) => {
          if (settled) return;
          if (broadcastHash) {
            settle(() =>
              { callbacks.onUnknown(
                broadcastHash,
                'Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.',
              ); },
            );
            return;
          }
          failWithoutHash(value);
        },
      );
    }
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    isCallable(Reflect.get(value, 'then'))
  );
}

function isEventSource(value: unknown): value is DAppBroadcastEventSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    isCallable(Reflect.get(value, 'on'))
  );
}
