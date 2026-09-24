/** @jest-environment jsdom */
jest.mock("@/config", () => ({
  QRL_PROVIDER: {
    TEST_NET: { id: "TEST_NET", name: "Testnet", url: "https://legacy.invalid" },
  },
  EXPLORER_BASE: "https://explorer.invalid",
  getPendingTxApiUrl: jest.fn(),
}));
jest.mock("@/utils", () => ({ log: jest.fn() }));
jest.mock("@/utils/crypto", () => ({ deriveHexSeedAsync: jest.fn() }));
jest.mock("@/utils/storage", () => ({
  StorageUtil: jest.requireActual("@/utils/storage/storage").default,
}));
jest.mock("@/utils/nativeApp", () => ({ isInNativeApp: () => false }));
jest.mock("@/utils/web3", () => ({ getQrlWeb3: jest.fn() }));

import QrlStore from "../qrlStore";
import StorageUtil from "@/utils/storage/storage";

const ACCOUNT = `Q${"1".repeat(128)}`;
const BLOCKCHAIN = "TEST_NET";

beforeEach(() => {
  localStorage.clear();
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

async function storeWithStoredAccount() {
  const store = new QrlStore();
  store.qrlConnection = { ...store.qrlConnection, blockchain: BLOCKCHAIN };
  await StorageUtil.setAccountList(BLOCKCHAIN, [
    { address: ACCOUNT, source: "seed" },
  ]);
  await StorageUtil.setActiveAccount(BLOCKCHAIN, ACCOUNT);
  return store;
}

it("keeps a freshly provisioned active account when the balance refresh has not landed yet", async () => {
  const store = await storeWithStoredAccount();
  // A superseded fetchAccounts returns without writing qrlAccounts.accounts,
  // which is exactly the state right after a desktop import: the account is on
  // disk and in the stored list, but the in-memory balance list is still empty.
  store.qrlAccounts = { ...store.qrlAccounts, accounts: [] };

  await store.validateActiveAccount();

  expect(store.activeAccount.accountAddress).toBe(ACCOUNT);
  expect(await StorageUtil.getActiveAccount(BLOCKCHAIN)).toBe(ACCOUNT);
});

it("clears an active account that is no longer in the stored account list", async () => {
  const store = await storeWithStoredAccount();
  await StorageUtil.setAccountList(BLOCKCHAIN, []);
  store.qrlAccounts = {
    ...store.qrlAccounts,
    accounts: [{ accountAddress: ACCOUNT, accountBalance: "1", source: "seed" }],
  };

  await store.validateActiveAccount();

  expect(store.activeAccount.accountAddress).toBe("");
  expect(await StorageUtil.getActiveAccount(BLOCKCHAIN)).toBe("");
});
