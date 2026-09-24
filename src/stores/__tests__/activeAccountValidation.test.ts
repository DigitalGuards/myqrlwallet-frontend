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
import type { AccountSource } from "@/utils/storage/storage";
import { deriveHexSeedAsync } from "@/utils/crypto";

const ACCOUNT = `Q${"1".repeat(128)}`;
const BLOCKCHAIN = "TEST_NET";

beforeEach(() => {
  localStorage.clear();
  jest
    .spyOn(QrlStore.prototype, "initializeBlockchain")
    .mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

async function storeWithStoredAccount(source: AccountSource = "seed") {
  const store = new QrlStore();
  store.qrlConnection = { ...store.qrlConnection, blockchain: BLOCKCHAIN };
  await StorageUtil.setAccountList(BLOCKCHAIN, [
    { address: ACCOUNT, source },
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

it("adopts the stored source, so a remote-signer account never reads as seed", async () => {
  const store = await storeWithStoredAccount("extension");
  // Same window as above: confirmed from storage while the balance list, which
  // used to be the only source lookup, is still empty.
  store.qrlAccounts = { ...store.qrlAccounts, accounts: [] };

  await store.validateActiveAccount();

  expect(store.activeAccount.accountAddress).toBe(ACCOUNT);
  expect(store.activeAccountSource).toBe("extension");
});

it("refuses the local seed signing path for a mobile-sourced account", async () => {
  const store = await storeWithStoredAccount("mobile");
  store.qrlAccounts = { ...store.qrlAccounts, accounts: [] };
  await store.validateActiveAccount();

  await store.signAndSendTransaction(ACCOUNT, ACCOUNT, "1", "mnemonic words");

  expect(store.transactionStatus.state).toBe("failed");
  expect(store.transactionStatus.error).toContain("paired mobile app");
  expect(deriveHexSeedAsync).not.toHaveBeenCalled();
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
