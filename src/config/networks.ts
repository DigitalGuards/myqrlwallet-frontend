import { IS_V3_PROFILE } from "./runtimeProfile";
import { v3Deployment } from "./deploymentProfile";

const IS_PRODUCTION = import.meta.env.PROD;
const v3 = IS_V3_PROFILE ? v3Deployment(import.meta.env) : null;
export const TOKEN_FACTORY_ADDRESS = IS_V3_PROFILE
  ? ""
  : import.meta.env["VITE_CUSTOMERC20FACTORY_ADDRESS"] || "";

const RPC_API_BASE = IS_PRODUCTION
  ? import.meta.env["VITE_RPC_URL_PRODUCTION"] ||
    "https://qrlwallet.com/api/qrl-rpc"
  : import.meta.env["VITE_RPC_URL_DEVELOPMENT"] || "http://localhost:8545";

export const SERVER_URL =
  v3?.serverUrl ??
  (IS_PRODUCTION
    ? import.meta.env["VITE_SERVER_URL_PRODUCTION"] ||
      "https://qrlwallet.com/api"
    : import.meta.env["VITE_SERVER_URL_DEVELOPMENT"] ||
      "http://localhost:3000/api");

export const EXPLORER_BASE =
  v3?.network.explorer ??
  ((IS_PRODUCTION
    ? import.meta.env["VITE_EXPLORER_URL_PRODUCTION"]
    : import.meta.env["VITE_EXPLORER_URL_DEVELOPMENT"]) ||
    "https://zondscan.com");

export const QRL_PROVIDER = {
  TEST_NET_V3: v3?.network ?? {
    id: "TEST_NET_V3",
    name: "QRL Testnet v3 (Private)",
    url: "",
    explorer: "",
    expectedChainId: "",
    genesisHash: "",
    qrns: { expectedChainId: "", registry: "" },
  },
  TEST_NET: {
    id: "TEST_NET",
    url: `${RPC_API_BASE}/testnet`,
    name: "QRL 2.0 Testnet",
    explorer: EXPLORER_BASE,
    qrns: {
      expectedChainId: import.meta.env["VITE_QRNS_CHAIN_ID_TEST_NET"] || "",
      registry: import.meta.env["VITE_QRNS_REGISTRY_TEST_NET"] || "",
    },
  },
  MAIN_NET: {
    id: "MAIN_NET",
    url: `${RPC_API_BASE}/mainnet`,
    name: "QRL 2.0 Mainnet",
    explorer: EXPLORER_BASE,
    qrns: {
      expectedChainId: import.meta.env["VITE_QRNS_CHAIN_ID_MAIN_NET"] || "",
      registry: import.meta.env["VITE_QRNS_REGISTRY_MAIN_NET"] || "",
    },
  },
};

export const AVAILABLE_NETWORKS = IS_V3_PROFILE
  ? [QRL_PROVIDER.TEST_NET_V3]
  : [QRL_PROVIDER.TEST_NET, QRL_PROVIDER.MAIN_NET];
export const DEFAULT_NETWORK_ID = IS_V3_PROFILE ? "TEST_NET_V3" : "TEST_NET";
export const isAvailableNetwork = (id: string): boolean =>
  AVAILABLE_NETWORKS.some((network) => network.id === id);

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
export const getTokenDiscoveryApiUrl = (
  address: string,
  blockchain: string,
) => {
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
