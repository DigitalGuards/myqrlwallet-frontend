/** @jest-environment jsdom */

import { configure } from "mobx";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";
import NftStore from "../nftStore";
import type { NFTInterface, TokenInterface } from "@/constants";
import { walletMutations } from "@/utils/nativeWalletMutation";
import { deriveHexSeedAsync } from "@/utils/crypto";
import { FEE_NOT_SHOWN, type ApprovedFeeInput } from "@/utils/web3/feePolicy";
import { StorageUtil } from "@/utils/storage";
import { isCallable } from "@/utils/guards";

const ACCOUNT = `Q${"1".repeat(128)}`;
const RECIPIENT = `Q${"2".repeat(128)}`;
const CONTRACT = `Q${"3".repeat(128)}`;
const CHAIN_ID = "0x301825";
let mockDesktop = false;
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
  sendTransaction: jest.fn(() => mockSendEvent),
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
    signAndSendTransaction: jest.fn(() => Promise.resolve({ transactionHash: '0xbroadcast' })),
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

const TOKEN: TokenInterface = {
  address: CONTRACT,
  name: "Test token",
  symbol: "TEST",
  amount: "10",
  decimals: 0,
};

function deferred() {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

function assetFixture(asset: "ERC20" | "ERC721" | "ERC1155") {
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
  const ready = jest
    .spyOn(store, "assertNetworkReady")
    .mockResolvedValue(undefined);
  const tokens = new TokenStore(store);
  const nfts = new NftStore(store, tokens);
  const send = (approvedFee: ApprovedFeeInput = FEE_NOT_SHOWN) => {
    if (asset === "ERC20")
      return tokens.sendToken(
        TOKEN,
        "1",
        "test mnemonic",
        RECIPIENT,
        "medium",
        approvedFee,
      );
    const nft: NFTInterface = {
      contractAddress: CONTRACT,
      tokenId: "1",
      standard: asset,
    };
    return nfts.transferNft(nft, RECIPIENT, "test mnemonic", 1n, "medium", approvedFee);
  };
  return { store, tokens, nfts, ready, send };
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockDesktop = false;
  mockHandlers.clear();
  mockRpc.getGasPrice.mockResolvedValue(1n);
  mockRpc.estimateGas.mockResolvedValue(50000n);
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each(["ERC20", "ERC721", "ERC1155"] as const)(
  "v3 %s signing",
  (asset) => {
    it.each([
      ["initial", 1],
      ["final", 3],
    ] as const)(
      "cancels when the wallet is cleared during the %s identity check",
      async (_stage, pausedCheck) => {
        const { store, ready, send } = assetFixture(asset);
        const enteredCheck = deferred();
        const identityCheck = deferred();
        let checks = 0;
        ready.mockImplementation(async () => {
          checks += 1;
          if (checks === pausedCheck) {
            enteredCheck.resolve();
            await identityCheck.promise;
          }
        });

        const pending = send();
        await enteredCheck.promise;
        if (pausedCheck === 3) {
          expect(mockRpc.wallet.add).toHaveBeenCalledWith("public-test-seed");
        } else {
          expect(mockRpc.wallet.add).not.toHaveBeenCalled();
        }
        expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
        const generation = walletMutations.captureGeneration();
        await walletMutations.clear(() => undefined);
        expect(walletMutations.isCurrent(generation)).toBe(false);
        identityCheck.resolve();

        expect(await pending).toBe(false);
        expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
        expect(store.transactionStatus.state).toBe("failed");
        expect(store.transactionStatus.error).toMatch(/Wallet changed/);
      },
    );

    it("pins the verified v3 chain in the submitted transaction", async () => {
      const { ready, send } = assetFixture(asset);
      expect(await send()).toBe(true);
      expect(ready).toHaveBeenCalledTimes(3);
      expect(ready).toHaveBeenLastCalledWith(mockRpc);
      expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
      expect(mockRpc.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: CHAIN_ID,
          from: ACCOUNT,
          to: CONTRACT,
        }),
        undefined,
        { checkRevertBeforeSending: true },
      );
    });

    it("stops before loading a signing seed when initial identity verification fails", async () => {
      const { store, ready, send } = assetFixture(asset);
      ready.mockRejectedValueOnce(
        new Error("Testnet v3 genesis identity mismatch"),
      );
      expect(await send()).toBe(false);
      expect(deriveHexSeedAsync).not.toHaveBeenCalled();
      expect(mockRpc.wallet.add).not.toHaveBeenCalled();
      expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
      expect(store.transactionStatus.error).toContain(
        "genesis identity mismatch",
      );
    });
  },
);


const assets: ('ERC20' | 'ERC721' | 'ERC1155')[] = ['ERC20', 'ERC721', 'ERC1155'];
describe.each(assets)('%s fee conversions', (asset) => {
  it.each([50001n, 50001, '0xc351'])(
    'retains signed gas and fee types for RPC estimate %p', async (estimate) => {
      const { send } = assetFixture(asset);
      mockRpc.estimateGas.mockResolvedValueOnce(estimate);
      const gas = asset === 'ERC20' ? estimate : 60001n;
      expect(await send({
        quote: { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
        gasLimit: asset === 'ERC20' ? 50001n : 60001n,
      })).toBe(true);
      expect(mockRpc.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ gas, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
        undefined, { checkRevertBeforeSending: true },
      );
    },
  );

  it('refuses a total fee above the approved amount', async () => {
    const { send } = assetFixture(asset);
    mockRpc.estimateGas.mockResolvedValueOnce('0xc351');
    expect(await send({
      quote: { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
      gasLimit: asset === 'ERC20' ? 50000n : 60000n,
    })).toBe(false);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });
});

it.each([101n, 101, '0x65'])(
  'preserves token-creation gas rounding and gas-price conversion for %p', async (price) => {
    const { tokens } = assetFixture('ERC20');
    mockRpc.getGasPrice.mockResolvedValueOnce(price);
    await tokens.createToken('Created', 'CRT', '100', 8, '1000', RECIPIENT, '10', '10', 'test mnemonic');
    expect(mockRpc.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 60001n, gasPrice: 111n }),
      undefined, { checkRevertBeforeSending: true },
    );
  },
);

it('finishes a creation receipt while its persistence promise remains pending', async () => {
  const { tokens } = assetFixture('ERC20');
  const persisted = deferred();
  const write = jest.spyOn(StorageUtil, 'setCreatedToken').mockReturnValueOnce(persisted.promise);
  await tokens.createToken('Created', 'CRT', '100', 8, '1000', RECIPIENT, '10', '10', 'test mnemonic');
  const receipt = mockHandlers.get('receipt');
  if (!isCallable(receipt)) throw new Error('Receipt handler missing');
  await receipt({
    logs: [{ address: `Q${'4'.repeat(128)}`, topics: [
      `0x${'a'.repeat(64)}${'0'.repeat(64)}`, `0x${'3'.repeat(128)}`,
    ] }],
    transactionHash: '0xtransaction', blockHash: '0xblock',
    blockNumber: '0x2a', gasUsed: 50001n, effectiveGasPrice: '0x65',
  });
  expect(write).toHaveBeenCalledWith(
    'Created', 'CRT', 8, CONTRACT, '0xtransaction', 42, 50001, 101, '0xblock',
  );
  expect(tokens.creatingToken).toEqual({ name: '', creating: false, error: undefined });
  expect(tokens.createdToken.address).toBe('');
  persisted.resolve();
  await persisted.promise;
  expect(tokens.createdToken.address).toBe(CONTRACT);
});

it('starts both NFT receipt refreshes in order without waiting for completion', async () => {
  const balance = deferred();
  const accounts = deferred();
  const order: string[] = [];
  const refresh = jest.spyOn(NftStore.prototype, 'refreshNftBalances')
    .mockImplementation(() => { order.push('balances'); return balance.promise; });
  const fetch = jest.spyOn(QrlStore.prototype, 'fetchAccounts')
    .mockImplementation(() => { order.push('accounts'); return accounts.promise; });
  const { send } = assetFixture('ERC721');
  expect(await send()).toBe(true);
  const receipt = mockHandlers.get('receipt');
  if (!isCallable(receipt)) throw new Error('Receipt handler missing');
  expect(receipt({ transactionHash: '0xbroadcast' })).toBeUndefined();
  expect(order).toEqual(['balances', 'accounts']);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  balance.resolve();
  accounts.resolve();
  await Promise.all([balance.promise, accounts.promise]);
});

it('starts desktop NFT polling before balance refresh and returns while both wait', async () => {
  mockDesktop = true;
  const receipt = deferred();
  const balance = deferred();
  const order: string[] = [];
  const poll = jest.spyOn(QrlStore.prototype, 'pollForReceipt')
    .mockImplementation(() => { order.push('receipt'); return receipt.promise; });
  const refresh = jest.spyOn(NftStore.prototype, 'refreshNftBalances')
    .mockImplementation(() => { order.push('balances'); return balance.promise; });
  const { send } = assetFixture('ERC721');
  expect(await send()).toBe(true);
  expect(order).toEqual(['receipt', 'balances']);
  expect(poll).toHaveBeenCalledWith('0xbroadcast');
  expect(refresh).toHaveBeenCalledTimes(1);
  receipt.resolve();
  balance.resolve();
  await Promise.all([receipt.promise, balance.promise]);
});
