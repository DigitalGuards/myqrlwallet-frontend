import { isReceiptStatusSuccess } from '@/utils/web3/txPolling';

export interface DAppBroadcastEventSource {
  on(event: string, listener: (value: unknown) => void): unknown;
}

interface DAppBroadcastSettlementCallbacks {
  onTransactionHash(hash: string): void;
  onSuccess(hash: string): void;
  onFailure(error: string): void;
}

function transactionHashFromReceipt(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const hash = (value as Record<string, unknown>)['transactionHash'];
  return typeof hash === 'string' ? hash : String(hash ?? '');
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
      callbacks.onTransactionHash(value);
    });
    eventSource.on('receipt', (value) => {
      if (settled) return;
      const receipt =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : null;
      if (!receipt || !isReceiptStatusSuccess(receipt['status'])) {
        settle(() => callbacks.onFailure('Transaction has been reverted by the QRVM'));
        return;
      }
      const hash = transactionHashFromReceipt(receipt);
      settle(() => callbacks.onSuccess(hash));
    });
    eventSource.on('error', (value) => {
      const error = value instanceof Error ? value.message : String(value);
      settle(() => callbacks.onFailure(error));
    });
  });
}
