import { receiptExecutionStatus } from '@/utils/web3/txPolling';

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
  if (!value || typeof value !== 'object') return '';
  const hash = (value as Record<string, unknown>)['transactionHash'];
  if (typeof hash === 'string') return hash;
  if (hash instanceof Uint8Array) {
    return `0x${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return '';
}

export function getDAppReceiptStatus(receipt: unknown, transactionHash?: string): boolean | undefined {
  const hash = transactionHashFromReceipt(receipt);
  if (!hash || (transactionHash && hash.toLowerCase() !== transactionHash.toLowerCase())) return undefined;
  return receiptExecutionStatus((receipt as Record<string, unknown>)['status']);
}

/**
 * PromiEvents may emit receipt followed by error for a reverted transaction.
 * This adapter owns one-shot settlement so one request can receive exactly one
 * approval or rejection, never both.
 */
export function waitForDAppBroadcastSettlement(
  source: unknown,
  callbacks: DAppBroadcastSettlementCallbacks,
): Promise<void> {
  if (
    !source ||
    typeof source !== 'object' ||
    typeof (source as Record<string, unknown>)['on'] !== 'function'
  ) {
    return Promise.reject(new Error('Invalid transaction event source'));
  }
  const eventSource = source as DAppBroadcastEventSource;
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
      const receipt =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : null;
      const hash = transactionHashFromReceipt(receipt);
      const succeeded = getDAppReceiptStatus(receipt, broadcastHash);
      if (succeeded === undefined) {
        settle(() => callbacks.onUnknown(broadcastHash || hash, 'Transaction confirmation is unavailable. Check the explorer before sending again.'));
        return;
      }
      if (succeeded === false) {
        settle(() => callbacks.onFailure('Transaction has been reverted by the QRVM'));
        return;
      }
      settle(() => callbacks.onSuccess(hash));
    });
    eventSource.on('error', (value) => {
      const error = value instanceof Error ? value.message : String(value);
      if (broadcastHash) {
        settle(() => callbacks.onUnknown(broadcastHash, 'Transaction was broadcast, but confirmation is unavailable. Check the explorer before sending again.'));
        return;
      }
      settle(() => callbacks.onFailure(error));
    });
  });
}
