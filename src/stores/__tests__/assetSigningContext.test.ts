/** @jest-environment jsdom */
// A network, provider, account or source switch while the store awaits its
// own checks must stop the NFT transfer and the token creation before
// anything is signed or broadcast, on the seed path and on the desktop path.

import { configure } from "mobx";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";
import NftStore from "../nftStore";
import type { NFTInterface } from "@/constants";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";
import { StorageUtil } from "@/utils/storage";

const ACCOUNT = `Q${"1".repeat(128)}`;
const RECIPIENT = `Q${"2".repeat(128)}`;
const CONTRACT = `Q${"3".repeat(128)}`;
let mockDesktop = false;
const mockDesktopSign = jest.fn(() => Promise.resolve({ transactionHash: "0xbroadcast" }));
const mockHandlers = new Map<string, unknown>();
const mockSendEvent = {
  on: jest.fn((name: string, handler: unknown): unknown => {
    mockHandlers.set(name, handler);
    return mockSendEvent;
  }),
};
const mockContractGas = jest.fn(() => Promise.resolve(50001n));
const mockUtils = {
  keccak256: () => `0x${'a'.repeat(64)}`,
  bytesToHex: (value: string) => value,
};
const mockRpc = {
  accounts: { seedToAccount: jest.fn(() => ({ address: ACCOUNT })) },
  wallet: { add: jest.fn() },
  getGasPrice: jest.fn((): Promise<unknown> => Promise.resolve(1n)),
  getCode: jest.fn(() => Promise.resolve('0x01')),
  estimateGas: jest.fn((): Promise<unknown> => Promise.resolve(50000n)),
  sendTransaction: jest.fn((_transaction: unknown, ..._rest: unknown[]) => mockSendEvent),
  Contract: class {
    methods = {
      createToken: () => ({ encodeABI: () => '0x1234', estimateGas: mockContractGas }),
      transfer: () => ({
        encodeABI: () => "0x1234",
        estimateGas: () => Promise.resolve(50000n),
      }),
    };
  },
};

jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: true,
  profileStorageKey: (key: string) => `qrlwallet:v3:${key}`,
  assertV3BrowserContext: jest.fn(),
  assertSupportedAccountSource: jest.fn(),
}));
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET_V3: {
      id: "TEST_NET_V3",
      url: "https://v3.example/rpc",
      explorer: "https://explorer.example",
      expectedChainId: "0x301825",
    },
  },
  TOKEN_FACTORY_ADDRESS: `Q${'4'.repeat(128)}`,
  EXPLORER_BASE: "https://explorer.example",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(() => Promise.resolve("public-test-seed")),
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() { return mockDesktop; },
  desktopSigner: {
    signAndSendTransaction: () => mockDesktopSign(),
  },
}));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: {
    setCreatedToken: jest.fn(() => Promise.resolve(undefined)),
    getBlockChain: jest.fn(() => Promise.resolve("TEST_NET_V3")),
    // The local seed signing paths confirm the active account's source
    // against the persisted list before touching any seed material.
    getAccountList: jest.fn(() =>
      Promise.resolve([{ address: `Q${"1".repeat(128)}`, source: "seed" }]),
    ),
  },
}));
jest.mock("@/utils/web3", () => ({
  fetchTokenInfo: jest.fn(() => Promise.resolve({ name: 'Created', symbol: 'CRT', decimals: 8n })),
  getQrlWeb3: jest.fn(() =>
    Promise.resolve({
      default: class {
        static providers: { HttpProvider: new (url: string) => object } = {
          HttpProvider: jest.fn<object, [string]>(() => ({})),
        };
        qrl = mockRpc;
        utils = mockUtils;
      },
      utils: { bytesToHex: (value: string) => value },
    }),
  ),
}));
jest.mock("@/utils/web3/contractFactory", () => ({
  contractMethods: () => ({
    safeTransferFrom: () => ({ encodeABI: () => "0x5678" }),
  }),
}));
jest.mock("@/utils/web3/nft", () => ({}));
jest.mock("@/utils/formatting", () => ({}));


const OTHER = `Q${"5".repeat(128)}`;
const NFT = { contractAddress: CONTRACT, tokenId: "1", standard: "ERC721" } satisfies NFTInterface;

class OtherProvider {
  readonly id = "other";
}

function fixture() {
  const store = new QrlStore();
  store.qrlConnection = {
    ...store.qrlConnection,
    blockchain: "TEST_NET_V3",
    isConnected: true,
    isLoading: false,
  };
  store.activeAccount.accountAddress = ACCOUNT;
  store.qrlAccounts.accounts = [
    { accountAddress: ACCOUNT, accountBalance: "10", source: "seed" },
  ];
  jest.spyOn(store, "assertNetworkReady").mockResolvedValue(undefined);
  const tokens = new TokenStore(store);
  const nfts = new NftStore(store, tokens);
  return { store, tokens, nfts };
}

const CHANGES: [string, (store: QrlStore) => void][] = [
  ["network", (store) => { store.qrlConnection = { ...store.qrlConnection, blockchain: "MAIN_NET" }; }],
  ["provider", (store) => { Object.assign(store, { qrlInstance: new OtherProvider() }); }],
  ["account", (store) => { store.activeAccount = { ...store.activeAccount, accountAddress: OTHER }; }],
  ["source", (store) => {
    store.qrlAccounts.accounts = [
      { accountAddress: ACCOUNT, accountBalance: "10", source: "extension" },
    ];
  }],
];

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.clearAllMocks();
  mockDesktop = false;
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Holds the store's own StorageUtil.getBlockChain await open. */
function holdBlockchainRead() {
  let release: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    jest.mocked(StorageUtil.getBlockChain).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve();
          release = () => { done("TEST_NET_V3"); };
        }),
    );
  });
  return { entered, release: () => { release(); } };
}

describe.each([
  ["seed path", false],
  ["desktop path", true],
])("NFT transfer (%s)", (_label, desktop) => {
  it.each(CHANGES)("signs nothing when the %s changes during the store's awaits", async (_name, change) => {
    mockDesktop = desktop;
    const { store, nfts } = fixture();
    const hold = holdBlockchainRead();
    const pending = nfts.transferNft(NFT, RECIPIENT, "test mnemonic", 1n, "medium", FEE_NOT_SHOWN);
    await hold.entered;
    change(store);
    hold.release();
    expect(await pending).toBe(false);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    expect(mockDesktopSign).not.toHaveBeenCalled();
    expect(store.transactionStatus.error).toMatch(
      /Wallet changed while preparing the NFT transfer$/,
    );
  });
});

describe.each([
  ["seed path", false],
  ["desktop path", true],
])("token creation (%s)", (_label, desktop) => {
  it.each(CHANGES)("signs nothing when the %s changes during the store's awaits", async (_name, change) => {
    mockDesktop = desktop;
    const { store, tokens } = fixture();
    const hold = holdBlockchainRead();
    const pending = tokens.createToken("Name", "SYM", "1", 8, "0", RECIPIENT, "0", "0", "test mnemonic");
    await hold.entered;
    change(store);
    hold.release();
    await expect(pending).rejects.toThrow("Wallet changed while preparing token creation");
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
    expect(mockDesktopSign).not.toHaveBeenCalled();
    expect(tokens.creatingToken).toMatchObject({
      creating: false,
      error: "Wallet changed while preparing token creation",
    });
  });
});

it("still transfers an NFT and creates a token when nothing changes", async () => {
  const { nfts, tokens } = fixture();
  expect(await nfts.transferNft(NFT, RECIPIENT, "test mnemonic", 1n, "medium", FEE_NOT_SHOWN)).toBe(true);
  await tokens.createToken("Name", "SYM", "1", 8, "0", RECIPIENT, "0", "0", "test mnemonic");
  expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(2);
});
