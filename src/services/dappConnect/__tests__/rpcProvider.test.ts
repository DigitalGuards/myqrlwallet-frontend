import { Web3 } from '@theqrl/web3';
import {
  assertRequestedTransactionChain,
  getRequestProvider,
  readWalletChainId,
} from '../rpcProvider';

describe('published Web3 dApp RPC adapter', () => {
  it('unwraps the actual HttpProvider envelope through the request manager', async () => {
    const web3 = new Web3('http://127.0.0.1:8545');
    if (!web3.currentProvider) throw new Error('Missing test HttpProvider');
    const request = jest
      .spyOn(web3.currentProvider, 'request')
      .mockImplementation(async (payload) => ({
        jsonrpc: '2.0',
        id: payload.id,
        result: payload.method === 'qrl_chainId' ? '0x301825' : { number: '0x0', hash: '0x1234' },
      }));
    await expect(readWalletChainId(web3.qrl)).resolves.toBe('0x301825');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ jsonrpc: '2.0', method: 'qrl_chainId' })
    );
    const adapter = getRequestProvider(web3.qrl);
    if (!adapter) throw new Error('Missing test RPC adapter');
    await expect(
      adapter.request({
        method: 'qrl_getBlockByNumber',
        params: ['0x0', false],
      })
    ).resolves.toEqual({ number: '0x0', hash: '0x1234' });
    request.mockRestore();
  });

  it('rejects a real provider RPC error instead of returning it as a result', async () => {
    const web3 = new Web3('http://127.0.0.1:8545');
    if (!web3.currentProvider) throw new Error('Missing test HttpProvider');
    const request = jest.spyOn(web3.currentProvider, 'request').mockImplementation(
      async (payload) =>
        ({
          jsonrpc: '2.0',
          id: payload.id,
          error: { code: -32000, message: 'RPC unavailable' },
        }) as never
    );
    await expect(readWalletChainId(web3.qrl)).rejects.toThrow();
    request.mockRestore();
  });

  it('preserves the EIP-1193 fallback and its provider receiver', async () => {
    const currentProvider = {
      request: jest.fn(async function (this: unknown) {
        expect(this).toBe(currentProvider);
        return '0x301825';
      }),
    };
    await expect(readWalletChainId({ currentProvider })).resolves.toBe('0x301825');
  });

  it('checks the requested chain on every approval and rejects a switched provider', async () => {
    let chain = '0x301825';
    const web3 = { currentProvider: { request: jest.fn(async () => chain) } };
    const transaction = { chainId: '0x301825' };
    await expect(assertRequestedTransactionChain(transaction, web3)).resolves.toBeUndefined();
    chain = '0x539';
    await expect(assertRequestedTransactionChain(transaction, web3)).rejects.toThrow(
      'does not match'
    );
    expect(web3.currentProvider.request).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed chain responses and leaves optional legacy requests valid', async () => {
    await expect(
      readWalletChainId({
        currentProvider: { request: async () => ({ result: '0x301825' }) },
      })
    ).rejects.toThrow('invalid chain id');
    await expect(assertRequestedTransactionChain({}, null)).resolves.toBeUndefined();
    await expect(assertRequestedTransactionChain({ chainId: 'invalid' }, null)).rejects.toThrow();
  });
});
