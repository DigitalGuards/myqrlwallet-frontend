import type { PersistedSession } from "./KeyExchange";
import type { WalletEpoch } from "@/utils/walletEpoch";

/** dApp metadata received during connection */
export interface DAppInfo {
  name: string;
  url: string;
  icon?: string;
  chainId: string;
  /**
   * Optional return-to-dApp target sent by the dApp in ORIGINATOR_INFO.
   * After the wallet resolves a restricted request, the native app opens
   * this so a same-device deep-link user is bounced back to the dApp.
   */
  redirectUrl?: string;
}

/**
 * A connected dApp session (persisted in localStorage).
 *
 * Storage v4 denotes PQP3-derived keys and checkpoints the AEAD counters after
 * every successful seal/open. Earlier records are deliberately dropped so a
 * pre-PQP3 key is never resumed after the capability-bound protocol upgrade.
 */
export interface DAppSession {
  version: 4;
  id: string;
  dappInfo: DAppInfo;
  /** True only after this session's qrl_requestAccounts was approved. */
  accountAuthorized: boolean;
  /** Exact account bound by that approval, or empty while unauthorized. */
  connectedAccount: string;
  /** Whether the first authenticated ORIGINATOR_INFO has been pinned. */
  originatorInfoReceived: boolean;
  keyExchange: PersistedSession;
  relayUrl?: string;
  status: SessionStatus;
  createdAt: number;
  lastActivity: number;
  /** Wallet identity generation that is allowed to restore this key. */
  walletEpoch?: WalletEpoch;
}

export enum SessionStatus {
  CONNECTING = "connecting",
  KEY_EXCHANGE = "key_exchange",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  DISCONNECTED = "disconnected",
}

/** A pending JSON-RPC request from a dApp */
export interface PendingDAppRequest {
  id: string | number;
  sessionId: string;
  method: string;
  params?: unknown[];
  dappInfo: DAppInfo;
  timestamp: number;
}

/** Key-exchange message types (must match SDK) */
export enum KeyExchangeMessageType {
  SYN = "key_handshake_SYN",
  SYNACK = "key_handshake_SYNACK",
  ACK = "key_handshake_ACK",
}

/** Message types (must match SDK) */
export enum MessageType {
  KEY_EXCHANGE = "key_exchange",
  JSONRPC = "jsonrpc",
  WALLET_INFO = "wallet_info",
  ORIGINATOR_INFO = "originator_info",
  TERMINATE = "terminate",
  PING = "ping",
  READY = "ready",
}

/** Wire message format sent through the relay */
export interface RelayMessage {
  id: string;
  clientType: "dapp" | "wallet";
  message: string | object;
}

/** JSON-RPC request */
export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method: string;
  params?: unknown[];
}

/** JSON-RPC response */
export interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
