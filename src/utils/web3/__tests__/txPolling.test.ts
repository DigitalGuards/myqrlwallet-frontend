/**
 * Guards the QRL transaction-polling config: that it stays sane for a ~60s block
 * time, that the installed web3 actually honors it (catches a config-API change
 * on a future web3 upgrade), and that it genuinely improves on the web3 defaults.
 */
import Web3 from '@theqrl/web3';
import {
  isReceiptStatusSuccess,
  QRL_TX_POLLING_CONFIG,
  waitForTransactionReceipt,
} from '../txPolling';

const PROVIDER = () => new Web3.providers.HttpProvider('http://localhost:8545');

describe('QRL_TX_POLLING_CONFIG', () => {
  it('polls slowly enough for a ~60s block time and waits on a single confirmation', () => {
    expect(QRL_TX_POLLING_CONFIG.transactionPollingInterval).toBeGreaterThanOrEqual(5000);
    expect(QRL_TX_POLLING_CONFIG.transactionConfirmationBlocks).toBeLessThanOrEqual(2);
    expect(QRL_TX_POLLING_CONFIG.transactionPollingTimeout).toBeGreaterThanOrEqual(QRL_TX_POLLING_CONFIG.transactionPollingInterval);
  });

  it('is actually applied by the installed @theqrl/web3 (guards against a config-API change on upgrade)', () => {
    const { qrl } = new Web3({ provider: PROVIDER(), config: QRL_TX_POLLING_CONFIG });
    expect(qrl.transactionPollingInterval).toBe(QRL_TX_POLLING_CONFIG.transactionPollingInterval);
    expect(qrl.transactionConfirmationBlocks).toBe(QRL_TX_POLLING_CONFIG.transactionConfirmationBlocks);
    expect(qrl.transactionPollingTimeout).toBe(QRL_TX_POLLING_CONFIG.transactionPollingTimeout);
  });

  it('improves drastically over the web3 4.x defaults it replaces', () => {
    // Documents the defaults that caused ~100 RPC calls/tx; if a web3 upgrade
    // changes these, this test flags that our override math needs review.
    const { qrl } = new Web3(PROVIDER());
    expect(qrl.transactionPollingInterval).toBe(1000);
    expect(qrl.transactionConfirmationBlocks).toBe(24);
    expect(QRL_TX_POLLING_CONFIG.transactionPollingInterval).toBeGreaterThan(qrl.transactionPollingInterval);
    expect(QRL_TX_POLLING_CONFIG.transactionConfirmationBlocks).toBeLessThan(qrl.transactionConfirmationBlocks);
  });
});

describe('waitForTransactionReceipt', () => {
  const HASH = '0x' + 'ab'.repeat(32);
  const RECEIPT = { status: 1n, transactionHash: HASH };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the receipt once getReceipt returns one', async () => {
    const getReceipt = jest
      .fn<Promise<typeof RECEIPT | null>, [string]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(RECEIPT);

    const resultPromise = waitForTransactionReceipt(getReceipt, HASH, {
      intervalMs: 1000,
      timeoutMs: 10_000,
    });
    await jest.advanceTimersByTimeAsync(3000);

    await expect(resultPromise).resolves.toEqual({ status: 'receipt', receipt: RECEIPT });
    expect(getReceipt).toHaveBeenCalledTimes(3);
    expect(getReceipt).toHaveBeenCalledWith(HASH);
  });

  it('treats a thrown getReceipt as still-pending (v2 node throws "transaction not found")', async () => {
    const getReceipt = jest
      .fn<Promise<typeof RECEIPT | null>, [string]>()
      .mockRejectedValueOnce(new Error('transaction not found'))
      .mockRejectedValueOnce(new Error('transaction not found'))
      .mockResolvedValue(RECEIPT);

    const resultPromise = waitForTransactionReceipt(getReceipt, HASH, {
      intervalMs: 1000,
      timeoutMs: 10_000,
    });
    await jest.advanceTimersByTimeAsync(3000);

    await expect(resultPromise).resolves.toEqual({ status: 'receipt', receipt: RECEIPT });
  });

  it('resolves {status: timeout} after exactly floor(timeout/interval) polls', async () => {
    const getReceipt = jest.fn<Promise<null>, [string]>().mockResolvedValue(null);

    const resultPromise = waitForTransactionReceipt(getReceipt, HASH, {
      intervalMs: 1000,
      timeoutMs: 5500,
    });
    await jest.advanceTimersByTimeAsync(6000);

    await expect(resultPromise).resolves.toEqual({ status: 'timeout' });
    expect(getReceipt).toHaveBeenCalledTimes(5);
  });

  it('defaults its cadence to QRL_TX_POLLING_CONFIG (waits a full interval before the first poll)', async () => {
    const getReceipt = jest.fn<Promise<typeof RECEIPT>, [string]>().mockResolvedValue(RECEIPT);

    const resultPromise = waitForTransactionReceipt(getReceipt, HASH);
    await jest.advanceTimersByTimeAsync(QRL_TX_POLLING_CONFIG.transactionPollingInterval - 1);
    expect(getReceipt).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual({ status: 'receipt', receipt: RECEIPT });
    expect(getReceipt).toHaveBeenCalledTimes(1);
  });

  it('stops polling after resolution', async () => {
    const getReceipt = jest.fn<Promise<typeof RECEIPT>, [string]>().mockResolvedValue(RECEIPT);

    const resultPromise = waitForTransactionReceipt(getReceipt, HASH, {
      intervalMs: 1000,
      timeoutMs: 10_000,
    });
    await jest.advanceTimersByTimeAsync(1000);
    await resultPromise;

    await jest.advanceTimersByTimeAsync(10_000);
    expect(getReceipt).toHaveBeenCalledTimes(1);
  });

  it('polls at least once even when timeoutMs < intervalMs', async () => {
    const getReceipt = jest.fn<Promise<typeof RECEIPT>, [string]>().mockResolvedValue(RECEIPT);

    const resultPromise = waitForTransactionReceipt(getReceipt, HASH, {
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await jest.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({ status: 'receipt', receipt: RECEIPT });
    expect(getReceipt).toHaveBeenCalledTimes(1);
  });
});

describe('isReceiptStatusSuccess', () => {
  it.each([
    [1n, true],
    [0n, false], // web3's exact revert check: status === BigInt(0)
    [1, true],
    [0, false],
    [true, true],
    [false, false],
    ['0x1', true],
    ['0x0', false],
    ['1', true],
    ['0', false],
    [undefined, true], // absent status counts as success, like web3
    [null, true],
  ])('%p -> %p', (status, expected) => {
    expect(isReceiptStatusSuccess(status)).toBe(expected);
  });
});
