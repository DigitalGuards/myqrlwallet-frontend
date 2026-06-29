const RPC_API_BASE = import.meta.env['VITE_NODE_ENV'] === 'production'
  ? import.meta.env['VITE_RPC_URL_PRODUCTION']
  : import.meta.env['VITE_RPC_URL_DEVELOPMENT'];  // Using Vite's default port

export const SERVER_URL = import.meta.env['VITE_NODE_ENV'] === 'production'
  ? import.meta.env['VITE_SERVER_URL_PRODUCTION']
  : import.meta.env['VITE_SERVER_URL_DEVELOPMENT'];

export const EXPLORER_BASE = (import.meta.env['VITE_NODE_ENV'] === 'production'
  ? import.meta.env['VITE_EXPLORER_URL_PRODUCTION']
  : import.meta.env['VITE_EXPLORER_URL_DEVELOPMENT']) || 'https://zondscan.com';

import {
  ADDRESS_FORMATS,
  DEFAULT_ADDRESS_FORMAT,
  type AddressFormat,
  type AddressFormatId,
} from "@/config/addressFormat";

// Feature flag for the (not-yet-existent) 64-byte next-gen testnet. Kept dark
// until the QRL devs ship a 64-byte testnet + 64-byte-aware @theqrl libs and
// confirm its chainId/RPC endpoint (open questions in the 64-byte migration
// plan). When that lands, add a TEST_NET_NG entry with addressFormat:
// 'nextgen64' and gate its visibility on this flag.
export const NEXTGEN_TESTNET_ENABLED =
  import.meta.env['VITE_ENABLE_NEXTGEN_TESTNET'] === 'true';

export const QRL_PROVIDER = {
  TEST_NET: {
    id: "TEST_NET",
    url: `${RPC_API_BASE}/testnet`,
    name: "QRL 2.0 Testnet",
    explorer: EXPLORER_BASE,
    chainId: 1337,
    addressFormat: "legacy20" as AddressFormatId,
  },
  MAIN_NET: {
    id: "MAIN_NET",
    url: `${RPC_API_BASE}/mainnet`,
    name: "QRL 2.0 Mainnet",
    explorer: EXPLORER_BASE,
    chainId: 1337,
    addressFormat: "legacy20" as AddressFormatId,
  }
};

/**
 * Resolve the address format for a given network id. Defaults to legacy 20-byte
 * for unknown networks. This is the single switch that flips a network to the
 * 64-byte format once it exists.
 */
export const getAddressFormat = (blockchain: string): AddressFormat => {
  const provider = QRL_PROVIDER[blockchain as keyof typeof QRL_PROVIDER];
  const id = provider?.addressFormat;
  return id ? ADDRESS_FORMATS[id] : DEFAULT_ADDRESS_FORMAT;
};

export const getExplorerAddressUrl = (address: string, blockchain: string) => {
  const provider = QRL_PROVIDER[blockchain as keyof typeof QRL_PROVIDER];
  return `${provider.explorer}/address/${address}`;
};

// New function to get explorer URL for a transaction hash
export const getExplorerTxUrl = (txHash: string, blockchain: string) => {
  const provider = QRL_PROVIDER[blockchain as keyof typeof QRL_PROVIDER];
  // Assuming the explorer path for transactions is /tx/
  return `${provider.explorer}/tx/${txHash}`;
};

// New function to get the API endpoint for pending transactions
export const getPendingTxApiUrl = (blockchain: string) => {
  const provider = QRL_PROVIDER[blockchain as keyof typeof QRL_PROVIDER];
  // Append the known API path to the explorer base URL
  return `${provider.explorer}/api/pending-transactions`;
};

// Get API endpoint for token discovery by address. Phase 3b on zondscan
// added a `?standard=` filter; we scope to ERC-20 so this endpoint only
// returns fungibles. Without the filter the response also includes one
// row per (NFT contract, tokenID) the address holds, and the wallet's
// ERC-20-aware renderer treats those as 18-decimal fungibles and shows
// "Amount: 0" for every NFT row.
export const getTokenDiscoveryApiUrl = (address: string, blockchain: string) => {
  const provider = QRL_PROVIDER[blockchain as keyof typeof QRL_PROVIDER];
  return `${provider.explorer}/api/address/${address}/tokens?standard=ERC-20`;
};

// Get API endpoint for NFT discovery by address. The /nfts endpoint
// returns per-(contract, tokenID) rows joined with collection-level
// metadata (collectionName / collectionSymbol) AND per-token metadata
// from Phase 3b (name / image / description / attributes), so a single
// call powers the wallet's NFT picker with thumbnails and names.
export const getNFTDiscoveryApiUrl = (address: string, blockchain: string) => {
  const provider = QRL_PROVIDER[blockchain as keyof typeof QRL_PROVIDER];
  return `${provider.explorer}/api/address/${address}/nfts`;
};
