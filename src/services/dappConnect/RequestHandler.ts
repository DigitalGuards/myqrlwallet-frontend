/**
 * Request Handler - Routes incoming JSON-RPC requests from dApps.
 * Restricted methods are queued for user approval.
 * Unrestricted methods could be auto-proxied (future enhancement).
 */

import type { PendingDAppRequest, DAppInfo, JsonRpcRequest } from './types';
import { computeTypedDataDigest, TYPED_DATA_LIMITS } from '@/utils/signing';
import { Q_ADDRESS_PATTERN } from './accountBinding';

/**
 * Methods that require user approval.
 *
 * Signing surface is post-quantum-native: `qrl_signMessage` for opaque
 * bytes, `qrl_signTypedData` for EIP-712-shaped structured payloads.
 * The previous Ethereum-flavored methods (`personal_sign`, `qrl_sign`,
 * `qrl_signTypedData_v3`, `qrl_signTypedData_v4`) were removed in SDK
 * v3.0.0 / wallet feat/post-quantum-signing; dApps still sending them
 * will receive a "method not supported" error from the SDK before the
 * request reaches the wallet.
 */
const RESTRICTED_METHODS = new Set([
  'qrl_requestAccounts',
  'qrl_sendTransaction',
  'qrl_signTransaction',
  'qrl_signMessage',
  'qrl_signTypedData',
  'wallet_switchQrlChain',
]);

/** Exact, read-only RPC surface allowed to bypass the approval UI. */
const UNRESTRICTED_METHODS = new Set([
  'qrl_chainId',
  'qrl_blockNumber',
  'qrl_getBalance',
  'qrl_getTransactionCount',
  'qrl_getBlockByNumber',
  'qrl_getTransactionReceipt',
  'qrl_call',
  'qrl_estimateGas',
  'qrl_gasPrice',
  'qrl_getCode',
  'qrl_getLogs',
  'net_version',
  'net_listening',
]);

const LOCAL_READ_METHODS = new Set(['qrl_accounts']);

export const DAPP_TRANSACTION_LIMITS = Object.freeze({
  maxDataBytes: 128 * 1024,
  maxQuantityHexDigits: 64,
});

const RPC_QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const TRANSACTION_FIELDS = new Set(['from', 'to', 'value', 'gas', 'data']);

function validateRpcQuantity(value: unknown, field: 'value' | 'gas'): void {
  if (field === 'gas' && typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) return;
    throw new Error('transaction gas must be a non-negative safe integer');
  }
  if (
    typeof value !== 'string' ||
    value.length > DAPP_TRANSACTION_LIMITS.maxQuantityHexDigits + 2 ||
    !RPC_QUANTITY_PATTERN.test(value)
  ) {
    throw new Error(`transaction ${field} must be a canonical 0x quantity`);
  }
  if (field === 'gas' && BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('transaction gas exceeds the wallet safe-integer limit');
  }
}

function validateTransactionParams(params: unknown): void {
  if (!Array.isArray(params) || params.length !== 1) {
    throw new Error('transaction request requires exactly one transaction object');
  }
  const candidate = params[0];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('transaction request requires exactly one transaction object');
  }
  const tx = candidate as Record<string, unknown>;
  const unsupported = Object.keys(tx).find(field => !TRANSACTION_FIELDS.has(field));
  if (unsupported) throw new Error(`transaction field is not supported: ${unsupported}`);

  if (typeof tx['from'] !== 'string' || !Q_ADDRESS_PATTERN.test(tx['from'])) {
    throw new Error('transaction from must be a valid Q-address');
  }
  // Both current signing runtimes require a recipient, so contract creation
  // is deliberately not accepted through this approval surface.
  if (typeof tx['to'] !== 'string' || !Q_ADDRESS_PATTERN.test(tx['to'])) {
    throw new Error('transaction to must be a valid Q-address');
  }
  if ('value' in tx) validateRpcQuantity(tx['value'], 'value');
  if ('gas' in tx) validateRpcQuantity(tx['gas'], 'gas');
  if (
    'data' in tx &&
    (typeof tx['data'] !== 'string' ||
      tx['data'].length > DAPP_TRANSACTION_LIMITS.maxDataBytes * 2 + 2 ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx['data']))
  ) {
    throw new Error('transaction data must be bounded 0x-prefixed bytes');
  }
}

export class RequestHandler {
  static isValidJsonRpcId(value: unknown): value is string | number {
    return (
      (typeof value === 'string' && value.length > 0 && value.length <= 128) ||
      (typeof value === 'number' && Number.isSafeInteger(value))
    );
  }

  static validateJsonRpcEnvelope(value: Record<string, unknown>): {
    id: string | number;
    method: string;
    params?: unknown[];
  } {
    const id = value['id'];
    const method = value['method'];
    const params = value['params'];
    if (value['jsonrpc'] !== '2.0') {
      throw new Error('JSON-RPC version must be exactly 2.0');
    }
    if (!RequestHandler.isValidJsonRpcId(id)) {
      throw new Error('JSON-RPC id must be a safe integer or non-empty bounded string');
    }
    if (typeof method !== 'string' || method.length === 0 || method.length > 128) {
      throw new Error('JSON-RPC method must be a bounded string');
    }
    if (params !== undefined && !Array.isArray(params)) {
      throw new Error('JSON-RPC params must be an array when provided');
    }
    return {
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
  }

  /**
   * Check if a method requires user approval.
   */
  static isRestricted(method: string): boolean {
    return RESTRICTED_METHODS.has(method);
  }

  /**
   * Create a PendingDAppRequest from an incoming JSON-RPC request.
   */
  static createPendingRequest(
    sessionId: string,
    request: JsonRpcRequest,
    dappInfo: DAppInfo
  ): PendingDAppRequest {
    return {
      id: request.id ?? Date.now(),
      sessionId,
      method: request.method,
      params: request.params,
      dappInfo,
      timestamp: Date.now(),
    };
  }

  /**
   * Validate approval-bound input at relay ingress. A dApp can bypass the npm
   * SDK and speak encrypted JSON-RPC directly, so SDK validation is never a
   * wallet security boundary.
   */
  static validateRestrictedRequest(method: string, params: unknown): void {
    if (method === 'qrl_requestAccounts') {
      if (params !== undefined && (!Array.isArray(params) || params.length !== 0)) {
        throw new Error('qrl_requestAccounts does not accept parameters');
      }
      return;
    }

    if (method === 'qrl_sendTransaction' || method === 'qrl_signTransaction') {
      validateTransactionParams(params);
      return;
    }

    if (method === 'qrl_signMessage') {
      if (!Array.isArray(params) || params.length !== 2) {
        throw new Error('qrl_signMessage requires [signer, messageHex]');
      }
      const [signer, messageHex] = params;
      if (typeof signer !== 'string' || !/^Q[0-9a-fA-F]{40}$/.test(signer)) {
        throw new Error('qrl_signMessage requires a valid Q-address signer');
      }
      if (
        typeof messageHex !== 'string' ||
        messageHex.length > TYPED_DATA_LIMITS.maxDynamicBytes * 2 + 2 ||
        !/^0x([0-9a-fA-F]{2})*$/.test(messageHex)
      ) {
        throw new Error('qrl_signMessage requires bounded 0x-prefixed bytes');
      }
      return;
    }

    if (method === 'qrl_signTypedData') {
      if (!Array.isArray(params) || params.length !== 2) {
        throw new Error('qrl_signTypedData requires [signer, payload]');
      }
      const [signer, payload] = params;
      if (typeof signer !== 'string' || !/^Q[0-9a-fA-F]{40}$/.test(signer)) {
        throw new Error('qrl_signTypedData requires a valid Q-address signer');
      }
      // Full recursive validation, including resource budgets, happens while
      // producing the deterministic digest. Discarding the digest is cheap and
      // keeps the ingress rules byte-identical to the eventual signing path.
      computeTypedDataDigest(payload);
      return;
    }

    if (method === 'wallet_switchQrlChain') {
      if (!Array.isArray(params) || params.length !== 1) {
        throw new Error('wallet_switchQrlChain requires one chain configuration object');
      }
      const config = params[0];
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('wallet_switchQrlChain requires one chain configuration object');
      }
      const chainId = (config as Record<string, unknown>)['chainId'];
      if (typeof chainId !== 'string' || chainId.length > 66 || !/^0x[0-9a-fA-F]+$/.test(chainId)) {
        throw new Error('wallet_switchQrlChain requires a 0x-prefixed chainId');
      }
    }
  }

  /**
   * Validate that a method is known/supported.
   */
  static isKnownMethod(method: string): boolean {
    // Closed policy: prefix matching turns every future qrl_/wallet_ method
    // into an accidental capability. In particular qrl_sendRawTransaction
    // would broadcast state changes without a wallet-owned approval path.
    return (
      RESTRICTED_METHODS.has(method) ||
      UNRESTRICTED_METHODS.has(method) ||
      LOCAL_READ_METHODS.has(method)
    );
  }

  static isLocalRead(method: string): boolean {
    return LOCAL_READ_METHODS.has(method);
  }
}
