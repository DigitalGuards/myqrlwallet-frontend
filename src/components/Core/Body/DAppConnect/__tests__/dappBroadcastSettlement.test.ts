import {
  waitForDAppBroadcastSettlement,
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
    });

    source.emit('transactionHash', '0xpending');
    source.emit('receipt', { transactionHash: '0xreverted', status: false });
    source.emit('error', new Error('execution reverted'));
    source.emit('transactionHash', '0xlate');
    await settled;

    expect(hashes).toEqual(['0xpending']);
    expect(approvals).toEqual([]);
    expect(rejections).toEqual(['Transaction has been reverted by the QRVM']);
  });
});
