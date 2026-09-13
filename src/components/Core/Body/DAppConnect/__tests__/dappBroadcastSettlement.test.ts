import {
  waitForDAppBroadcastSettlement,
  getDAppReceiptStatus,
  type DAppBroadcastEventSource,
} from '../dappBroadcastSettlement';

class FakePromiEvent implements DAppBroadcastEventSource {
  private readonly listeners = new Map<string, Array<(value: unknown) => void>>();

  on(event: string, listener: (value: unknown) => void): this {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
    return this;
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

describe('dApp broadcast one-shot settlement', () => {
  it('rejects a reverted receipt exactly once and ignores the later error', async () => {
    const source = new FakePromiEvent();
    const approvals: string[] = [];
    const rejections: string[] = [];
    const hashes: string[] = [];
    const settled = waitForDAppBroadcastSettlement(source, {
      onTransactionHash: (hash) => hashes.push(hash),
      onSuccess: (hash) => approvals.push(hash),
      onFailure: (error) => rejections.push(error),
      onUnknown: jest.fn(),
    });

    source.emit('transactionHash', '0xpending');
    source.emit('receipt', { transactionHash: '0xpending', status: false });
    source.emit('error', new Error('execution reverted'));
    source.emit('transactionHash', '0xlate');
    await settled;

    expect(hashes).toEqual(['0xpending']);
    expect(approvals).toEqual([]);
    expect(rejections).toEqual(['Transaction has been reverted by the QRVM']);
  });

  it.each([
    { transactionHash: '0xpending' },
    { transactionHash: '0xpending', status: 'invalid' },
    { transactionHash: '0xother', status: 1n },
    { status: 1n },
  ])('settles uncertain receipts neutrally and keeps the broadcast hash: %p', async (receipt) => {
    const source = new FakePromiEvent();
    const callbacks = { onTransactionHash: jest.fn(), onSuccess: jest.fn(), onFailure: jest.fn(), onUnknown: jest.fn() };
    const settled = waitForDAppBroadcastSettlement(source, callbacks);
    source.emit('transactionHash', '0xpending');
    source.emit('receipt', receipt);
    source.emit('error', new Error('observation failed'));
    await settled;
    expect(callbacks.onUnknown).toHaveBeenCalledTimes(1);
    expect(callbacks.onUnknown).toHaveBeenCalledWith('0xpending', expect.stringContaining('confirmation is unavailable'));
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it('keeps an observation error after broadcast distinct from failed execution', async () => {
    const source = new FakePromiEvent();
    const callbacks = { onTransactionHash: jest.fn(), onSuccess: jest.fn(), onFailure: jest.fn(), onUnknown: jest.fn() };
    const settled = waitForDAppBroadcastSettlement(source, callbacks);
    source.emit('transactionHash', '0xpending');
    source.emit('error', new Error('receipt timeout'));
    await settled;
    expect(callbacks.onUnknown).toHaveBeenCalledWith('0xpending', expect.stringContaining('was broadcast'));
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, undefined], [null, undefined], [2, undefined], ['1oops', undefined],
    [1n, true], ['0x1', true], [0n, false], ['0x0', false],
  ])('uses the same strict execution evidence for desktop and event receipts: %p', (status, expected) => {
    expect(getDAppReceiptStatus({ transactionHash: '0xabc', status }, '0xabc')).toBe(expected);
  });

  it('compares byte-array receipt hashes to the original broadcast hash', () => {
    expect(getDAppReceiptStatus({ transactionHash: new Uint8Array([171]), status: 1n }, '0xab')).toBe(true);
    expect(getDAppReceiptStatus({ transactionHash: new Uint8Array([171]), status: 1n }, '0xcd')).toBeUndefined();
  });
});
