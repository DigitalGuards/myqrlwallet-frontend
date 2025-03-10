const API_BASE = import.meta.env.VITE_NODE_ENV === 'production'
  ? import.meta.env.VITE_RPC_URL_PRODUCTION
  : import.meta.env.VITE_RPC_URL_DEVELOPMENT;  // Using Vite's default port

const ZONDSCAN_BASE = import.meta.env.VITE_NODE_ENV === 'production'
  ? import.meta.env.VITE_ZOND_SCAN_URL_PRODUCTION
  : import.meta.env.VITE_ZOND_SCAN_URL_DEVELOPMENT;

export const ZOND_PROVIDER = {
  TEST_NET: {
    id: "TEST_NET",
    url: `${API_BASE}/testnet`,
    name: "Zond Testnet",
    explorer: ZONDSCAN_BASE
  },
  MAIN_NET: {
    id: "MAIN_NET",
    url: `${API_BASE}/mainnet`,
    name: "Zond Mainnet",
    explorer: ZONDSCAN_BASE
  },
  CUSTOM_RPC: {
    id: "CUSTOM_RPC",
    url: `${API_BASE}/custom`,
    name: "Custom RPC",
    explorer: ZONDSCAN_BASE
  }
};

export const getExplorerAddressUrl = (address: string, blockchain: string) => {
  const provider = ZOND_PROVIDER[blockchain as keyof typeof ZOND_PROVIDER];
  return `${provider.explorer}/address/${address}`;
};
