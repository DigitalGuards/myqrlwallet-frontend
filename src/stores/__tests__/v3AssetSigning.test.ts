/** @jest-environment jsdom */

import { configure } from "mobx";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";
import NftStore from "../nftStore";
import type { NFTInterface, TokenInterface } from "@/constants";
import { walletMutations } from "@/utils/nativeWalletMutation";
import { deriveHexSeedAsync } from "@/utils/crypto";

const ACCOUNT = `Q${"1".repeat(128)}`;
const RECIPIENT = `Q${"2".repeat(128)}`;
const CONTRACT = `Q${"3".repeat(128)}`;
const CHAIN_ID = "0x301825";
const mockSendEvent = { on: jest.fn().mockReturnThis() };
const mockRpc = {
  accounts: { seedToAccount: jest.fn(() => ({ address: ACCOUNT })) },
  wallet: { add: jest.fn() },
  getGasPrice: jest.fn(async () => 1n),
  estimateGas: jest.fn(async () => 50000n),
  sendTransaction: jest.fn(() => mockSendEvent),
  Contract: class {
    methods = {
      transfer: () => ({
        encodeABI: () => "0x1234",
        estimateGas: async () => 50000n,
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
  EXPLORER_BASE: "https://explorer.example",
  getPendingTxApiUrl: jest.fn(),
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: jest.fn(async () => "public-test-seed"),
}));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false, desktopSigner: {} }));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: jest.fn(async () => "TEST_NET_V3") },
}));
jest.mock("@/utils/web3", () => ({
  getQrlWeb3: jest.fn(async () => ({
    default: class {
      static providers: { HttpProvider: new (url: string) => object } = {
        HttpProvider: class {},
      };
      qrl = mockRpc;
    },
    utils: { bytesToHex: (value: string) => value },
  })),
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
  return { promise, resolve: () => settle() };
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
  const send = () => {
    if (asset === "ERC20")
      return tokens.sendToken(TOKEN, "1", "test mnemonic", RECIPIENT);
    const nft: NFTInterface = {
      contractAddress: CONTRACT,
      tokenId: "1",
      standard: asset,
    };
    return nfts.transferNft(nft, RECIPIENT, "test mnemonic");
  };
  return { store, ready, send };
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  jest.clearAllMocks();
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
