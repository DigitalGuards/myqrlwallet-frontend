import { isCallable } from '@/utils/guards';

export interface RpcRequestProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/** Web3's request manager builds JSON-RPC envelopes and unwraps provider results. */
export function getRequestProvider(web3: unknown): RpcRequestProvider | null {
  if (typeof web3 !== 'object' || web3 === null) return null;
  const manager: unknown = Reflect.get(web3, 'requestManager');
  if (typeof manager === 'object' && manager !== null) {
    const send: unknown = Reflect.get(manager, 'send');
    if (isCallable(send)) {
      return {
        request: (args) => toPromise(send.call(manager, args)),
      };
    }
  }
  const provider: unknown = Reflect.get(web3, 'currentProvider');
  if (typeof provider !== 'object' || provider === null) return null;
  const request: unknown = Reflect.get(provider, 'request');
  if (!isCallable(request)) return null;
  return {
    request: (args) => toPromise(request.call(provider, args)),
  };
}

function toPromise(value: unknown): Promise<unknown> {
  return Promise.resolve(value);
}

export function canonicalChainId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 66 || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error('Wallet RPC returned an invalid chain id');
  }
  return `0x${BigInt(value).toString(16)}`;
}

export async function readWalletChainId(web3: unknown): Promise<string> {
  const provider = getRequestProvider(web3);
  if (!provider) throw new Error('Web3 request provider unavailable');
  return canonicalChainId(await provider.request({ method: 'qrl_chainId', params: [] }));
}

export async function assertRequestedTransactionChain(
  params: Record<string, unknown>,
  web3: unknown
): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(params, 'chainId')) return;
  if (canonicalChainId(params['chainId']) !== (await readWalletChainId(web3))) {
    throw new Error('Transaction chain does not match the wallet network');
  }
}
