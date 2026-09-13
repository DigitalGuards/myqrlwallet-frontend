import { Web3 } from '@theqrl/web3';

import { normalizeQrlAddress } from '@/utils/web3/address';

const EXTENDED_SEED =
  '0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7';

describe('published QIP-55 web3 composition', () => {
  it('derives, ABI-encodes, and signs with a 64-byte address', async () => {
    const rpcMethods: string[] = [];
    const provider = {
      request: async ({ method }: { method: string }): Promise<string> => {
        rpcMethods.push(method);
        if (method === 'net_version') return '1';
        throw new Error(`Unexpected composition-test RPC method: ${method}`);
      },
    };
    const web3 = new Web3(provider as never);
    const account = web3.qrl.accounts.seedToAccount(EXTENDED_SEED);

    expect(account.address).toHaveLength(129);

    const encoded = web3.qrl.abi.encodeParameter('address', account.address);
    expect(encoded).toHaveLength(130);
    expect(normalizeQrlAddress(web3.qrl.abi.decodeParameter('address', encoded))).toBe(
      account.address,
    );

    const signed = await web3.qrl.accounts.signTransaction(
      {
        from: account.address,
        to: account.address,
        chainId: 1,
        nonce: 0,
        maxPriorityFeePerGas: 1,
        maxFeePerGas: 2,
        gas: 21_000,
        value: 1,
        data: '0x',
        type: '0x2',
      },
      EXTENDED_SEED,
    );

    expect(signed.rawTransaction).toMatch(/^0x[0-9a-f]+$/i);
    expect(signed.rawTransaction?.length).toBeGreaterThan(2 + (4_627 + 2_592) * 2);
    expect(signed.transactionHash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(rpcMethods).toEqual(['net_version']);
  });
});
