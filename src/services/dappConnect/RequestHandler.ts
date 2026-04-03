/**
 * Request Handler - Routes incoming JSON-RPC requests from dApps.
 * Restricted methods are queued for user approval.
 * Unrestricted methods could be auto-proxied (future enhancement).
 */

import type { PendingDAppRequest, DAppInfo, JsonRpcRequest } from './types';

/** Methods that require user approval */
const RESTRICTED_METHODS = new Set([
  'qrl_requestAccounts',
  'qrl_sendTransaction',
  'qrl_signTransaction',
  'qrl_sign',
  'personal_sign',
  'qrl_signTypedData',
  'qrl_signTypedData_v3',
  'qrl_signTypedData_v4',
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
    // Accept all qrl_*, net_*, web3_*, personal_*, wallet_* methods
    return /^(qrl|net|web3|personal|wallet)_/.test(method);
  }
}
