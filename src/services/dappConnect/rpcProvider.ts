export interface RpcRequestProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/** Web3's request manager builds JSON-RPC envelopes and unwraps provider results. */
export function getRequestProvider(web3: unknown): RpcRequestProvider | null {
  if (typeof web3 !== 'object' || web3 === null) return null;
  const manager = (web3 as { requestManager?: unknown }).requestManager;
  if (typeof manager === 'object' && manager !== null) {
    const send = (manager as { send?: unknown }).send;
    if (typeof send === 'function') {
      return {
        request: (args) => send.call(manager, args) as Promise<unknown>,
      };
    }
  }
  const provider = (web3 as { currentProvider?: unknown }).currentProvider;
  if (typeof provider !== 'object' || provider === null) return null;
  if (typeof (provider as { request?: unknown }).request !== 'function') return null;
  return provider as RpcRequestProvider;
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
