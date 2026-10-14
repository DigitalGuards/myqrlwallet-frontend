/** @jest-environment jsdom */
import StorageUtil, { blockchainKey } from "../storage";
import { QRL_PROVIDER } from "@/config";
import { isInNativeApp } from "@/utils/nativeApp";

jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { id: "TEST_NET", url: "https://test.invalid" },
    MAIN_NET: { id: "MAIN_NET", url: "https://main.invalid" },
    TEST_NET_V3: { id: "TEST_NET_V3", url: "https://v3.invalid" },
  },
}));
jest.mock("@/config/runtimeProfile", () => ({
  IS_V3_PROFILE: false,
  profileStorageKey: (key: string) => key,
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: jest.fn(() => false) }));
jest.mock("@/desktop/bridge", () => ({ isDesktop: false }));

const ADDRESS = `Q${"12".repeat(64)}`;
const SECOND = `Q${"34".repeat(64)}`;
const SEEDS_KEY = "TEST_NET_ENCRYPTED_SEEDS";
const token = {
  address: ADDRESS,
  amount: 123,
  decimals: "0x2",
  name: { en: "Token" },
  extra: [1],
};
const nft = {
  contractAddress: ADDRESS,
  standard: "ERC1155",
  tokenId: 0,
  balance: 12,
  name: { en: "NFT" },
  extra: [2],
};

function put(
  key: string,
  value: unknown,
  timestamp: unknown = Date.now(),
): string {
  const raw = JSON.stringify({ value, timestamp, version: "v1" });
  localStorage.setItem(key, raw);
  return raw;
}

beforeEach(() => {
  localStorage.clear();
  jest.mocked(isInNativeApp).mockReturnValue(false);
});
afterEach(() => {
  jest.restoreAllMocks();
});

type AccessorCase = {
  label: string;
  key: string;
  value: unknown;
  expected?: unknown;
  read: () => unknown;
};

const cases: AccessorCase[] = [
  {
    label: "active page",
    key: "ACTIVE_PAGE",
    value: "/tokens",
    read: () => StorageUtil.getActivePage(),
  },
  {
    label: "chain",
    key: "BLOCKCHAIN_SELECTION",
    value: "MAIN_NET",
    read: () => StorageUtil.getBlockChain(),
  },
  {
    label: "token list",
    key: `TEST_NET_${ADDRESS.toLowerCase()}_TOKEN_LIST`,
    value: [token, { address: SECOND }],
    read: () => StorageUtil.getTokenList("TEST_NET", ADDRESS),
  },
  {
    label: "legacy global tokens",
    key: "TOKEN_LIST",
    value: [token, { address: SECOND, amount: "9007199254740993" }],
    read: () => StorageUtil.getLegacyGlobalTokenList(),
  },
  {
    label: "legacy hidden tokens",
    key: "HIDDEN_TOKENS",
    value: [SECOND, ADDRESS, SECOND],
    read: () => StorageUtil.getLegacyGlobalHiddenTokens(),
  },
  {
    label: "active account",
    key: "TEST_NET_QIP55_ACTIVE_ACCOUNT",
    value: ADDRESS,
    read: () => StorageUtil.getActiveAccount("TEST_NET"),
  },
  {
    label: "legacy string accounts",
    key: "TEST_NET_QIP55_ACCOUNT_LIST",
    value: [ADDRESS],
    expected: [{ address: ADDRESS, source: "seed" }],
    read: () => StorageUtil.getAccountList("TEST_NET"),
  },
  {
    label: "transaction values",
    key: "TEST_NET_TRANSACTION_VALUES",
    value: { receiverAddress: ADDRESS, amount: "0x10", feeLevel: "old" },
    read: () => StorageUtil.getTransactionValues("TEST_NET"),
  },
  {
    label: "legacy settings",
    key: "WALLET_SETTINGS",
    value: { autoLockTimeout: 0, hideSmallBalances: false },
    expected: { autoLockTimeout: 0, showTokensCard: true, showNftsCard: true },
    read: () => StorageUtil.getWalletSettings(),
  },
  {
    label: "seed inventory",
    key: SEEDS_KEY,
    value: [
      { address: ADDRESS, encryptedSeed: "old", lastAccessed: 12 },
      { address: SECOND, revision: 9, lastAccessed: { legacy: true } },
      {},
    ],
    read: () => StorageUtil.getAllEncryptedSeeds("TEST_NET"),
  },
  {
    label: "hidden tokens",
    key: `TEST_NET_${ADDRESS.toLowerCase()}_HIDDEN_TOKENS`,
    value: [SECOND, ADDRESS, SECOND],
    read: () => StorageUtil.getHiddenTokens("TEST_NET", ADDRESS),
  },
  {
    label: "balance cache",
    key: "TEST_NET_BALANCE_CACHE",
    value: {
      [ADDRESS]: 12,
      [SECOND]: "9007199254740993",
      hex: "0x10",
      missing: null,
      metadata: { legacy: true },
    },
    read: () => StorageUtil.getBalanceCache("TEST_NET"),
  },
  {
    label: "NFT list",
    key: `TEST_NET_${ADDRESS.toLowerCase()}_NFT_LIST`,
    value: [
      nft,
      {
        contractAddress: SECOND,
        standard: "ERC721",
        tokenId: "0",
        balance: "0x10",
        fetchedAt: "10000",
        fetchFailedAt: [9000],
        fetchRetryCount: "2",
      },
    ],
    read: () => StorageUtil.getNftList("TEST_NET", ADDRESS),
  },
  {
    label: "hidden NFTs",
    key: `TEST_NET_${ADDRESS.toLowerCase()}_HIDDEN_NFTS`,
    value: [`${SECOND}:0`, `${ADDRESS}:7`, `${SECOND}:0`],
    read: () => StorageUtil.getHiddenNfts("TEST_NET", ADDRESS),
  },
];

it.each(cases)(
  "reads $label without changing stored values or order",
  async ({ key, value, expected, read }) => {
    const raw = put(key, value);
    const writes = jest.spyOn(Storage.prototype, "setItem");
    expect(await read()).toEqual(expected ?? value);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(writes).not.toHaveBeenCalled();
  },
);

it("keeps partial settings defaults, false toggles, and numeric transaction amounts", async () => {
  put("WALLET_SETTINGS", {
    autoLockTimeout: null,
    showTokensCard: false,
    showNftsCard: null,
  });
  expect(await StorageUtil.getWalletSettings()).toEqual({
    autoLockTimeout: 900000,
    showTokensCard: false,
    showNftsCard: true,
  });
  put("TEST_NET_TRANSACTION_VALUES", { amount: 0 });
  expect(await StorageUtil.getTransactionValues("TEST_NET")).toEqual({
    amount: 0,
  });
});

it("preserves legacy settings fields and default values for primitive containers", async () => {
  const settings = {
    autoLockTimeout: "1000",
    showTokensCard: "false",
    showNftsCard: { legacy: true },
  };
  put("WALLET_SETTINGS", settings);
  expect(await StorageUtil.getWalletSettings()).toEqual(settings);
  put("WALLET_SETTINGS", 0);
  expect(await StorageUtil.getWalletSettings()).toEqual({
    autoLockTimeout: 900000,
    showTokensCard: true,
    showNftsCard: true,
  });
  put("TEST_NET_BALANCE_CACHE", []);
  expect(await StorageUtil.getBalanceCache("TEST_NET")).toEqual([]);
});

it("retains stored navigation targets and transaction fields verbatim", async () => {
  for (const route of [0, -1, { pathname: "/tokens" }]) {
    put("ACTIVE_PAGE", route);
    expect(await StorageUtil.getActivePage()).toEqual(route);
  }
  const values = {
    receiverAddress: [ADDRESS],
    amount: { legacy: 1 },
    extra: true,
  };
  const raw = put("TEST_NET_TRANSACTION_VALUES", values);
  expect(await StorageUtil.getTransactionValues("TEST_NET")).toEqual(values);
  expect(localStorage.getItem("TEST_NET_TRANSACTION_VALUES")).toBe(raw);
});

it("preserves parse failures, expiry coercion, missing timestamps, and native bypass", async () => {
  localStorage.setItem("ACTIVE_PAGE", "broken");
  expect(await StorageUtil.getActivePage()).toBe("");
  expect(localStorage.getItem("ACTIVE_PAGE")).toBe("broken");
  const expired = String(Date.now() - 7 * 60 * 60 * 1000);
  put("ACTIVE_PAGE", "/old", expired);
  expect(await StorageUtil.getActivePage()).toBe("");
  expect(localStorage.getItem("ACTIVE_PAGE")).toBeNull();
  localStorage.setItem("ACTIVE_PAGE", JSON.stringify({ value: "/legacy" }));
  expect(await StorageUtil.getActivePage()).toBe("/legacy");
  jest.mocked(isInNativeApp).mockReturnValue(true);
  put("ACTIVE_PAGE", "/native", expired);
  expect(await StorageUtil.getActivePage()).toBe("/native");
});

it("keeps absent-data fallbacks and stale chain selection", async () => {
  expect(await StorageUtil.getTokenList("TEST_NET", ADDRESS)).toEqual([]);
  expect(await StorageUtil.getNftList("TEST_NET", ADDRESS)).toEqual([]);
  expect(await StorageUtil.getTransactionValues("TEST_NET")).toEqual({});
  expect(await StorageUtil.getBalanceCache("TEST_NET")).toEqual({});
  put("BLOCKCHAIN_SELECTION", "CUSTOM_RPC");
  expect(await StorageUtil.getBlockChain()).toBe("TEST_NET");
});

it("keeps incomplete seeds visible to existence and revision protection", async () => {
  const seeds = [
    { address: ADDRESS, revision: 9, lastAccessed: { old: true } },
    { address: SECOND, encryptedSeed: "other", revision: "7", extra: [1, 2] },
  ];
  const raw = put(SEEDS_KEY, seeds);
  expect(await StorageUtil.hasEncryptedSeeds("TEST_NET")).toBe(true);
  expect(
    await StorageUtil.restoreEncryptedSeedIfNewer(
      "TEST_NET",
      ADDRESS,
      "stale",
      8,
    ),
  ).toBe("skipped");
  expect(await StorageUtil.getAllEncryptedSeeds("TEST_NET")).toEqual(seeds);
  expect(localStorage.getItem(SEEDS_KEY)).toBe(raw);
  const updated = await StorageUtil.storeEncryptedSeed(
    "TEST_NET",
    ADDRESS,
    "new",
  );
  expect(updated.revision).toBe(10);
  expect(await StorageUtil.getAllEncryptedSeeds("TEST_NET")).toEqual([
    updated,
    { ...seeds[1], walletEpoch: "legacy" },
  ]);
});

it("preserves ciphertext and siblings when touching a seed with missing metadata", async () => {
  jest.spyOn(Date, "now").mockReturnValue(10000);
  const other = {
    address: SECOND,
    encryptedSeed: "other",
    lastAccessed: "10",
    revision: null,
    extra: { keep: true },
  };
  put(SEEDS_KEY, [
    { address: ADDRESS, encryptedSeed: "first", revision: 4 },
    other,
  ]);
  expect(await StorageUtil.getEncryptedSeed("TEST_NET", ADDRESS)).toBe("first");
  expect(await StorageUtil.getAllEncryptedSeeds("TEST_NET")).toEqual([
    {
      address: ADDRESS,
      encryptedSeed: "first",
      revision: 4,
      lastAccessed: 10000,
      walletEpoch: "legacy",
    },
    { ...other, walletEpoch: "legacy" },
  ]);
});

it("retains incomplete records in compare-and-swap and preserves unrelated bytes", async () => {
  const seeds = [
    { address: ADDRESS, encryptedSeed: "first", revision: 3 },
    { revision: 5 },
  ];
  const raw = put(SEEDS_KEY, seeds);
  expect(
    await StorageUtil.replaceEncryptedSeedSetIfUnchanged("TEST_NET", [], []),
  ).toBe(false);
  expect(localStorage.getItem(SEEDS_KEY)).toBe(raw);
  expect(await StorageUtil.getAllEncryptedSeeds("TEST_NET")).toEqual(seeds);
});

it("returns a stored list container unchanged until a consumer uses it", async () => {
  const key = `TEST_NET_${ADDRESS.toLowerCase()}_TOKEN_LIST`;
  const raw = put(key, { imported: true });
  expect(await StorageUtil.getTokenList("TEST_NET", ADDRESS)).toEqual({ imported: true });
  expect(localStorage.getItem(key)).toBe(raw);
});

it.each(cases.filter(({ label }) => [
  "token list", "legacy global tokens", "legacy hidden tokens", "hidden tokens", "NFT list", "hidden NFTs",
].includes(label)))("keeps every stored entry visible in $label", async ({ key, read }) => {
  const values = [token, nft, { tokenId: "legacy" }, { contractAddress: null }, null, false, 0, [], {}, "legacy"];
  const raw = put(key, values);
  expect(await read()).toEqual(values);
  expect(localStorage.getItem(key)).toBe(raw);
});

it.each([
  { value: "MAIN_NET", key: "MAIN_NET", account: ADDRESS },
  { value: ["MAIN_NET"], key: "MAIN_NET", account: ADDRESS },
  { value: [[["MAIN_NET"]]], key: "MAIN_NET", account: ADDRESS },
  { value: ["TEST_NET"], key: "TEST_NET", account: SECOND },
  { value: ["TEST_NET_V3"], key: "TEST_NET_V3", account: ADDRESS },
  { value: [["TEST_NET_V3"]], key: "TEST_NET_V3", account: ADDRESS },
])("keeps the provider, account and raw selection for $value", async ({ value, key, account }) => {
  await StorageUtil.setActiveAccount("MAIN_NET", ADDRESS);
  await StorageUtil.setActiveAccount("TEST_NET", SECOND);
  await StorageUtil.setActiveAccount("TEST_NET_V3", ADDRESS);
  const raw = put("BLOCKCHAIN_SELECTION", value);
  const selected = await StorageUtil.getBlockChain();
  expect(selected).toEqual(value);
  expect(blockchainKey(selected)).toBe(key);
  expect(QRL_PROVIDER[blockchainKey(selected)].id).toBe(key);
  expect(await StorageUtil.getActiveAccount(selected)).toBe(account);
  expect(localStorage.getItem("BLOCKCHAIN_SELECTION")).toBe(raw);
});

it.each([{ toString: null }, [{ toString: 0 }]])("preserves network property-key coercion errors for %j", async (value) => {
  const raw = put("BLOCKCHAIN_SELECTION", value);
  await expect(StorageUtil.getBlockChain()).rejects.toThrow(TypeError);
  expect(localStorage.getItem("BLOCKCHAIN_SELECTION")).toBe(raw);
});
