const API_BASE = process.env.NODE_ENV === 'production' 
  ? 'https://qrlwallet.com/api/zond-rpc'
  : 'http://localhost:3000/api/zond-rpc';

export const ZOND_PROVIDER = {
  DEV: { 
    id: "DEV",
    url: `${API_BASE}/dev`,
    name: "Zond Local Node"
  },
  TEST_NET: {
    id: "TEST_NET",
    url: `${API_BASE}/testnet`,
    name: "Zond Testnet"
  },
  MAIN_NET: {
    id: "MAIN_NET",
    url: `${API_BASE}/mainnet`,
    name: "Zond Mainnet"
  }
};
