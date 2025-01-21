const API_BASE = process.env.NODE_ENV === 'production' 
  ? 'https://qrlwallet.com/api/zond-rpc'
  : 'http://localhost:5173/api/zond-rpc';  // Using Vite's default port

const ZONDSCAN_BASE = process.env.NODE_ENV === 'production'
  ? 'https://zondscan.com'
  : 'https://zondscan.com';

export const ZOND_PROVIDER = {
  DEV: { 
    id: "DEV",
    url: `${API_BASE}/dev`,
    name: "Zond Local Node",
    explorer: ZONDSCAN_BASE
  },
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
  }
};

export const getExplorerAddressUrl = (address: string, blockchain: string) => {
  const provider = ZOND_PROVIDER[blockchain as keyof typeof ZOND_PROVIDER];
  return `${provider.explorer}/address/${address}`;
};
