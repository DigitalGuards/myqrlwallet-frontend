/**
 * Request Handler - Routes incoming JSON-RPC requests from dApps.
 * Restricted methods are queued for user approval.
 * Unrestricted methods could be auto-proxied (future enhancement).
 */

import type { PendingDAppRequest, DAppInfo, JsonRpcRequest } from './types';

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
  'wallet_addQrlChain',
  'wallet_switchQrlChain',
]);

export class RequestHandler {
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
   * Validate that a method is known/supported.
   */
  static isKnownMethod(method: string): boolean {
    // Accept qrl_*, net_*, web3_*, wallet_* methods. personal_* was the
    // Ethereum-flavored signing namespace removed in v3.0.0; such methods now
    // fall through to a clean -32601 "method not found" instead of being
    // forwarded to the RPC node.
    return /^(qrl|net|web3|wallet)_/.test(method);
  }
}
