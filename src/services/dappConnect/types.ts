/** dApp metadata received during connection */
export interface DAppInfo {
  name: string;
  url: string;
  icon?: string;
  chainId: string;
}

/** A connected dApp session */
export interface DAppSession {
  id: string; // channelId
  dappInfo: DAppInfo;
  connectedAccount: string;
  privateKey: string;
  otherPublicKey: string | null;
  relayUrl?: string;
  status: SessionStatus;
  createdAt: number;
  lastActivity: number;
}

export enum SessionStatus {
  CONNECTING = 'connecting',
  KEY_EXCHANGE = 'key_exchange',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  DISCONNECTED = 'disconnected',
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

/** Key exchange message types (must match SDK) */
export enum KeyExchangeMessageType {
  SYN = 'key_handshake_SYN',
  SYNACK = 'key_handshake_SYNACK',
  ACK = 'key_handshake_ACK',
}

/** Message types (must match SDK) */
export enum MessageType {
  KEY_EXCHANGE = 'key_exchange',
  JSONRPC = 'jsonrpc',
  WALLET_INFO = 'wallet_info',
  ORIGINATOR_INFO = 'originator_info',
  TERMINATE = 'terminate',
  PING = 'ping',
  READY = 'ready',
}

/** Wire message format sent through the relay */
export interface RelayMessage {
  id: string;
  clientType: 'dapp' | 'wallet';
  message: string | object;
}

/** QR connect URI parameters */
export interface ConnectParams {
  channelId: string;
  pubKey: string;
  name: string;
  url: string;
  icon?: string;
  chainId: string;
  relay: string;
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
