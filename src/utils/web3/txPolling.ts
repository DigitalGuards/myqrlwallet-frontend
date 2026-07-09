/**
 * web3.js transaction-polling config tuned for QRL's ~60-second block time.
 *
 * web3.js 4.x defaults are `transactionPollingInterval: 1000` (poll the receipt
 * every 1s) and `transactionConfirmationBlocks: 24` (keep polling for 24
 * confirmations after the receipt). On a 1-minute-block chain that fires ~100+
 * `getTransactionReceipt` / block RPC calls per transaction (~60 just to see
 * the receipt, then ~24 blocks ≈ 24 minutes of confirmation polling).
 *
 * These values poll every 7s and require a single confirmation, cutting it to
 * roughly ~10 RPC calls per tx. The user-facing "confirmed" state fires on the
 * `receipt` event (first inclusion), which is unaffected by
 * `transactionConfirmationBlocks`: that only controls how long web3 keeps
 * watching for additional confirmations afterward.
 *
 * NOTE on units: in web3.js 4.x BOTH `transactionPollingInterval` and
 * `transactionPollingTimeout` are MILLISECONDS (the default timeout is
 * `750 * 1000`, and web3 divides it by 1000 only to render the seconds in its
 * timeout error). This differs from web3.js 1.x where the timeout was seconds:
 * do not "convert" the timeout to seconds.
 */
export const QRL_TX_POLLING_CONFIG = {
  transactionPollingInterval: 7000, // ms
  transactionConfirmationBlocks: 1,
  transactionPollingTimeout: 7 * 60 * 1000, // ms (7 min, ~7 blocks), NOT seconds
};

export interface WaitForReceiptOptions {
  /** Poll cadence in ms. Default: QRL_TX_POLLING_CONFIG.transactionPollingInterval. */
  intervalMs?: number;
  /** Total polling window in ms. Default: QRL_TX_POLLING_CONFIG.transactionPollingTimeout. */
  timeoutMs?: number;
}

export type WaitForReceiptResult<R> = { status: 'receipt'; receipt: R } | { status: 'timeout' };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll for a transaction receipt by hash until it lands or the window closes.
 *
 * Hash-only counterpart to web3's PromiEvent receipt wait, for flows that get
 * a bare hash back (e.g. the desktop signer broadcasts in the main process and
 * returns only `transactionHash`). `getReceipt` is injected so callers choose
 * the provider and tests need no web3 instance.
 *
 * A THROWN `getReceipt` is treated as "not yet mined", never a failure: the
 * QRL v2 node throws "transaction not found" for pending transactions instead
 * of returning null (see qrlStore.pollForReceipt for the same tolerance).
 *
 * Waits before the first poll: on a ~60s-block chain no receipt can exist the
 * instant after broadcast.
 */
export async function waitForTransactionReceipt<R>(
  getReceipt: (txHash: string) => Promise<R | null | undefined>,
  txHash: string,
  options: WaitForReceiptOptions = {},
): Promise<WaitForReceiptResult<R>> {
  const intervalMs = options.intervalMs ?? QRL_TX_POLLING_CONFIG.transactionPollingInterval;
  const timeoutMs = options.timeoutMs ?? QRL_TX_POLLING_CONFIG.transactionPollingTimeout;
  const attempts = Math.max(1, Math.floor(timeoutMs / intervalMs));

  for (let attempt = 0; attempt < attempts; attempt++) {
    await sleep(intervalMs);
    try {
      const receipt = await getReceipt(txHash);
      if (receipt) {
        return { status: 'receipt', receipt };
      }
    } catch {
      // still pending (v2 node throws instead of returning null)
    }
  }

  return { status: 'timeout' };
}

/**
 * Whether a receipt's `status` field indicates success. Mirrors web3's revert
 * check (`transactionReceipt.status === BigInt(0)` means reverted; an absent
 * status counts as success), tolerant of the bigint/number/boolean/hex-string
 * shapes different return formats produce.
 */
export function isReceiptStatusSuccess(status: unknown): boolean {
  if (status === undefined || status === null) return true;
  if (typeof status === 'bigint') return status !== BigInt(0);
  if (typeof status === 'number') return status !== 0;
  if (typeof status === 'boolean') return status;
  if (typeof status === 'string') {
    const parsed = Number.parseInt(status, status.startsWith('0x') ? 16 : 10);
    return Number.isNaN(parsed) ? true : parsed !== 0;
  }
  return true;
}
