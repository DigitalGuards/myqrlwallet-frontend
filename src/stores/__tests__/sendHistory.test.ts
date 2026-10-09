/** @jest-environment jsdom */
import { configure } from "mobx";
import QrlStore from "../qrlStore";
import TokenStore from "../tokenStore";
import NftStore from "../nftStore";
import { transactionHistoryStore } from "../transactionHistoryStore";
import { parseUnits } from "@/utils/web3/units";
import { FEE_NOT_SHOWN } from "@/utils/web3/feePolicy";
import type { NFTInterface, TokenInterface } from "@/constants";

const from = `Q${"a".repeat(128)}`;
const to = `Q${"b".repeat(128)}`;
const hash = `0x${"c".repeat(64)}`;
const contract = `Q${"d".repeat(128)}`;
const mockParseUnits = parseUnits;
let mockDesktop = false;
const mockDesktopSend = jest.fn();
class Events {
  listeners = new Map<string, ((value: unknown) => void)[]>();
  on(event: string, listener: (value: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}
let mockEvents = new Events();
const mockRpc = {
  getTransactionCount: async () => 7n,
  getGasPrice: async () => 1000000000n,
  estimateGas: async () => 21000n,
  accounts: {
    signTransaction: async () => ({
      rawTransaction: "0x01",
      transactionHash: hash,
    }),
    seedToAccount: () => ({ address: from }),
  },
  wallet: { add: () => undefined },
  sendSignedTransaction: () => mockEvents,
  sendTransaction: () => mockEvents,
  Contract: class {
    methods = {
      transfer: () => ({
        encodeABI: () => "0x1234",
        estimateGas: async () => 21000n,
      }),
    };
  },
};

jest.mock("@/config", () => ({
  QRL_PROVIDER: { TEST_NET: { url: "https://rpc.example" } },
  EXPLORER_BASE: "",
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({
  deriveHexSeedAsync: async () => "test-seed",
}));
jest.mock("@/desktop/bridge", () => ({
  get isDesktop() {
    return mockDesktop;
  },
  desktopSigner: {
    signAndSendTransaction: (...args: unknown[]) => mockDesktopSend(...args),
  },
}));
jest.mock("@/desktop/walletHydration", () => ({}));
jest.mock("@/utils/storage", () => ({
  StorageUtil: { getBlockChain: async () => "TEST_NET" },
}));
jest.mock("@/utils/web3", () => ({
  getQrlWeb3: async () => ({
    default: class {
      static providers: { HttpProvider: new (url: string) => object } = {
        HttpProvider: class {},
      };
      qrl = mockRpc;
    },
    utils: {
      toPlanck: (value: string) => mockParseUnits(value).toString(),
      toHex: (value: bigint) => `0x${value.toString(16)}`,
      bytesToHex: (value: unknown) => value,
    },
  }),
}));
jest.mock("@/utils/nativeWalletMutation", () => ({
  walletMutations: { captureGeneration: () => 0, isCurrent: () => true },
}));
jest.mock("@/utils/web3/contractFactory", () => ({
  contractMethods: () => ({
    safeTransferFrom: () => ({ encodeABI: () => "0x5678" }),
  }),
}));
jest.mock("@/utils/web3/nft", () => ({}));
jest.mock("@/utils/formatting", () => ({}));

function store() {
  const wallet = new QrlStore();
  wallet.qrlConnection.blockchain = "TEST_NET";
  wallet.activeAccount.accountAddress = from;
  Object.assign(wallet, { qrlInstance: mockRpc });
  return wallet;
}

beforeEach(() => {
  configure({ enforceActions: "never" });
  jest.useFakeTimers();
  localStorage.clear();
  transactionHistoryStore.reload();
  mockEvents = new Events();
  mockDesktop = false;
  mockDesktopSend.mockReset().mockResolvedValue({ transactionHash: hash });
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
  jest
    .spyOn(QrlStore.prototype, "assertLocalSeedAccount")
    .mockResolvedValue(undefined);
  jest
    .spyOn(QrlStore.prototype, "fetchPendingTxDetails")
    .mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "fetchAccounts").mockResolvedValue(undefined);
  jest.spyOn(QrlStore.prototype, "pollForReceipt").mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("records a native seed send at broadcast and persists the receipt", async () => {
  const wallet = store();
  await wallet.signAndSendTransaction(
    from,
    to,
    "1.123456789012345678",
    "test-seed",
    "medium",
    FEE_NOT_SHOWN,
  );
  expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
  mockEvents.emit("transactionHash", hash);
  expect(transactionHistoryStore.getSnapshot().entries[0]).toMatchObject({
    from,
    to,
    hash,
    amount: "1.123456789012345678",
    nonce: "7",
    state: "pending",
  });
  mockEvents.emit("receipt", {
    transactionHash: hash,
    status: 0n,
    blockNumber: 8n,
  });
  expect(transactionHistoryStore.getSnapshot().entries[0]?.state).toBe(
    "failed",
  );
});

it("records desktop native broadcasts", async () => {
  mockDesktop = true;
  await store().signAndSendTransaction(
    from,
    to,
    "2",
    "",
    "medium",
    FEE_NOT_SHOWN,
  );
  expect(transactionHistoryStore.getSnapshot().entries[0]).toMatchObject({
    from,
    to,
    amount: "2",
    state: "pending",
  });
});

it.each(["extension", "mobile"] as const)(
  "records %s broadcasts under the captured account and network",
  async (source) => {
    const wallet = store();
    wallet.activeAccount.source = source;
    const provider = {
      request: jest.fn(async ({ method }: { method: string }) => {
        if (method === "qrl_accounts") return [from];
        wallet.activeAccount.accountAddress = to;
        wallet.qrlConnection.blockchain = "MAIN_NET";
        return hash;
      }),
    };
    Object.assign(
      wallet,
      source === "extension"
        ? { extensionProvider: provider }
        : { mobileProvider: provider },
    );
    await wallet.sendTransactionViaProvider(to, "2");
    if (source === "extension") {
      expect(provider.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: "qrl_accounts" }),
      );
    }
    expect(provider.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: "qrl_sendTransaction" }),
    );
    expect(transactionHistoryStore.getSnapshot().entries[0]).toMatchObject({
      blockchain: "TEST_NET",
      from,
      to,
      hash,
      amount: "2",
    });
  },
);

it("does not record a rejected remote send", async () => {
  const wallet = store();
  wallet.activeAccount.source = "mobile";
  Object.assign(wallet, {
    mobileProvider: {
      request: async () => {
        throw new Error("rejected");
      },
    },
  });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  await wallet.sendTransactionViaProvider(to, "2");
  expect(transactionHistoryStore.getSnapshot().entries).toHaveLength(0);
});

it("records token sends using the reviewed token amount and recipient", async () => {
  const wallet = store();
  const tokens = new TokenStore(wallet);
  const token: TokenInterface = {
    address: contract,
    name: "Token",
    symbol: "TKN",
    amount: "100",
    decimals: 6,
  };
  await tokens.sendToken(
    token,
    "1234567",
    "test-seed",
    to,
    "medium",
    FEE_NOT_SHOWN,
  );
  mockEvents.emit("transactionHash", hash);
  expect(transactionHistoryStore.getSnapshot().entries[0]).toMatchObject({
    from,
    to,
    hash,
    amount: "1.234567",
    asset: "TKN",
    state: "pending",
  });
});

it("records NFT sends using the recipient and token identifier", async () => {
  const wallet = store();
  const nfts = new NftStore(wallet, new TokenStore(wallet));
  const nft: NFTInterface = {
    contractAddress: contract,
    tokenId: "7",
    standard: "ERC721",
  };
  await nfts.transferNft(nft, to, "test-seed", 1n, "medium", FEE_NOT_SHOWN);
  mockEvents.emit("transactionHash", hash);
  expect(transactionHistoryStore.getSnapshot().entries[0]).toMatchObject({
    from,
    to,
    hash,
    amount: "1",
    asset: "NFT #7",
    state: "pending",
  });
});
