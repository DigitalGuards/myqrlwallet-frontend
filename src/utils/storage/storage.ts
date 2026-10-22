import { runAsPromise } from "@/utils/runAsPromise";
import {
  arrayValue,
  isArray,
  isRecord,
  stringValue,
  toNumber,
  toTemplateString,
} from "@/utils/guards";
import { QRL_PROVIDER } from "@/config";
import type { TokenInterface } from "@/constants";
import { isInNativeApp } from "@/utils/nativeApp";
import { isDesktop } from "@/desktop/bridge";
import {
  getWalletEpoch,
  INITIAL_WALLET_EPOCH,
  isWalletEpochCurrent,
  type WalletEpoch,
} from "@/utils/walletEpoch";
import { normalizeQrlAddress } from "@/utils/web3/address";
import { IS_V3_PROFILE, profileStorageKey } from "@/config/runtimeProfile";

const ACTIVE_PAGE_IDENTIFIER = profileStorageKey("ACTIVE_PAGE");
const BLOCKCHAIN_SELECTION_IDENTIFIER = profileStorageKey(
  "BLOCKCHAIN_SELECTION",
);
const BLOCKCHAIN_CREATED_TOKEN = profileStorageKey("CREATED_TOKEN");
const ACTIVE_ACCOUNT_IDENTIFIER = "QIP55_ACTIVE_ACCOUNT";
const ACCOUNT_LIST_IDENTIFIER = "QIP55_ACCOUNT_LIST";
const LEGACY_ACTIVE_ACCOUNT_IDENTIFIER = "ACTIVE_ACCOUNT";
const LEGACY_ACCOUNT_LIST_IDENTIFIER = "ACCOUNT_LIST";
const TRANSACTION_VALUES_IDENTIFIER = "TRANSACTION_VALUES";
const TOKEN_LIST_IDENTIFIER = IS_V3_PROFILE ? "TOKEN_LIST_V3" : "TOKEN_LIST";
const HIDDEN_TOKENS_IDENTIFIER = IS_V3_PROFILE
  ? "HIDDEN_TOKENS_V3"
  : "HIDDEN_TOKENS";
const NFT_LIST_IDENTIFIER = IS_V3_PROFILE ? "NFT_LIST_V3" : "NFT_LIST";
const HIDDEN_NFTS_IDENTIFIER = IS_V3_PROFILE ? "HIDDEN_NFTS_V3" : "HIDDEN_NFTS";
const BALANCE_CACHE_IDENTIFIER = "BALANCE_CACHE";
const STORAGE_VERSION = "v1";
const MAX_STORAGE_AGE = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const MAX_WALLETS = 10; // Maximum number of wallets that can be imported
const WALLET_SETTINGS_IDENTIFIER = profileStorageKey("WALLET_SETTINGS");
const ENCRYPTED_SEEDS_IDENTIFIER = "ENCRYPTED_SEEDS";
const AUTO_LOCK_TIMEOUT = 15 * 60 * 1000; // 15 minutes default auto-lock timeout

// Same-tab change events. The native `storage` event only fires in OTHER
// tabs, so we dispatch these on `window` to let other modules
// (e.g. autoLock) react to writes happening in the same tab without
// monkey-patching `localStorage.setItem`. Guarded against environments
// where `window` is undefined (SSR / tests).
export const STORAGE_EVENT_ACTIVE_ACCOUNT = "qrl-wallet:active-account-changed";
export const STORAGE_EVENT_WALLET_SETTINGS =
  "qrl-wallet:wallet-settings-changed";
const dispatchStorageEvent = (name: string) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(name));
  }
};

type TransactionValuesType = {
  receiverAddress?: unknown;
  amount?: unknown;
};

type BlockchainType = keyof typeof QRL_PROVIDER;
export type BlockchainSelection = string | unknown[];

interface StorageItem<T> {
  value: T;
  timestamp: number;
  version: string;
}

interface WalletSettings {
  language?: unknown;
  autoLockTimeout?: unknown;
  showTokensCard?: unknown;
  showNftsCard?: unknown;
}

export interface EncryptedSeedData {
  address?: unknown;
  encryptedSeed?: unknown;
  lastAccessed?: unknown;
  /**
   * Monotonic per-(blockchain,address) revision used by the native backup
   * protocol. Records written before the acknowledged-backup protocol have no
   * revision and are treated as revision 0.
   */
  revision?: unknown;
  /** Wallet identity generation that is allowed to read this ciphertext. */
  walletEpoch?: unknown;
}

function seedBelongsToEpoch(
  seed: EncryptedSeedData,
  epoch: WalletEpoch,
): boolean {
  return (
    seed.walletEpoch === epoch ||
    (seed.walletEpoch === undefined && epoch === INITIAL_WALLET_EPOCH)
  );
}

function seedRevision(seed: EncryptedSeedData | undefined): number {
  return seed &&
    typeof seed.revision === "number" &&
    Number.isSafeInteger(seed.revision) &&
    (seed.revision ?? 0) >= 0
    ? (seed.revision ?? 0)
    : 0;
}

function encryptedSeedSetsEqual(
  a: EncryptedSeedData[],
  b: EncryptedSeedData[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((seed, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      seed.address === other.address &&
      seed.encryptedSeed === other.encryptedSeed &&
      seed.lastAccessed === other.lastAccessed &&
      seedRevision(seed) === seedRevision(other) &&
      (seed.walletEpoch ?? INITIAL_WALLET_EPOCH) ===
        (other.walletEpoch ?? INITIAL_WALLET_EPOCH)
    );
  });
}

// Tracks where an account in ACCOUNT_LIST is signed: a locally stored seed,
// a browser extension, or the mobile app paired over the QRL Connect relay.
export type AccountSource = "seed" | "extension" | "mobile";

export interface AccountListItem {
  address: string;
  source: AccountSource;
}

function normalizeAccountListItem(value: unknown): AccountListItem | null {
  if (typeof value === "string") {
    const address = normalizeQrlAddress(value);
    return address ? { address, source: "seed" } : null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const record = value;
  const address = normalizeQrlAddress(record["address"]);
  const source = record["source"];
  if (
    !address ||
    (source !== "seed" && source !== "extension" && source !== "mobile")
  ) {
    return null;
  }
  return { address, source };
}

function normalizeAccountList(value: unknown): AccountListItem[] {
  if (!Array.isArray(value)) return [];
  const normalized: AccountListItem[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const item = normalizeAccountListItem(candidate);
    if (!item) continue;
    const key = item.address.toLowerCase();
    if (seen.has(key)) continue;
    normalized.push(item);
    seen.add(key);
  }
  return normalized;
}

function wrapWithMetadata<T>(value: T): StorageItem<T> {
  return {
    value,
    timestamp: Date.now(),
    version: STORAGE_VERSION,
  };
}

function isExpired(timestamp: unknown): boolean {
  // Native app has its own security (Device Login, auto-lock on background)
  // so we don't need the 6-hour expiration guardrail there
  if (isInNativeApp()) {
    return false;
  }
  return Date.now() - Number(timestamp) > MAX_STORAGE_AGE;
}

function getItem(key: string): unknown {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;

    const parsed: unknown = JSON.parse(item);
    if (!isRecord(parsed)) return null;

    // Check expiration
    // Preferences persist across wallet sessions, including the chosen language.
    if (key !== WALLET_SETTINGS_IDENTIFIER && isExpired(parsed["timestamp"])) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed["value"];
  } catch {
    return null;
  }
}

function isEncryptedSeedList(value: unknown): value is EncryptedSeedData[] {
  // Optional fields stay unknown so inventory and revision checks see every
  // record, including legacy records with incomplete metadata.
  return (
    isArray(value) && value.every((item) => item !== null && item !== undefined)
  );
}

function isTransactionValues(value: unknown): value is TransactionValuesType {
  return value !== null && value !== undefined;
}

function isWalletSettings(value: unknown): value is WalletSettings {
  return value !== null && value !== undefined;
}

function isBalanceCache(value: unknown): value is Record<string, unknown> {
  return value !== null && value !== undefined;
}

function isBlockchain(value: unknown): value is BlockchainType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(QRL_PROVIDER, value)
  );
}

function isBlockchainSelection(value: unknown): value is BlockchainSelection {
  return typeof value === "string" || isArray(value);
}

export function blockchainKey(value: BlockchainSelection): BlockchainType {
  return checkedValue(toTemplateString(value), isBlockchain);
}

// A failed shape check must preserve the stored value for recovery. In
// particular it must never become an empty list that a later write replaces.
function checkedValue<T>(
  value: unknown,
  guard: (value: unknown) => value is T,
): T {
  if (!guard(value)) throw new TypeError("Invalid stored value");
  return value;
}

function setItem(key: string, value: unknown): void {
  const item = wrapWithMetadata(value);
  localStorage.setItem(key, JSON.stringify(item));
}

function setItemAtWalletEpoch(
  key: string,
  value: unknown,
  expectedEpoch: WalletEpoch,
): void {
  if (!isWalletEpochCurrent(expectedEpoch)) {
    throw new Error("Wallet identity changed before sensitive storage write");
  }
  const serialized = JSON.stringify(wrapWithMetadata(value));
  localStorage.setItem(key, serialized);
  if (isWalletEpochCurrent(expectedEpoch)) return;

  // A wipe can race between the pre-write epoch check and localStorage's
  // setItem in another renderer process. Remove only our exact late value so
  // a new wallet imported after the wipe is never clobbered.
  if (localStorage.getItem(key) === serialized) localStorage.removeItem(key);
  throw new Error("Wallet identity changed during sensitive storage write");
}

/**
 * Token list - keyed by `${toTemplateString(blockchain)}_${account}` (mirrors the NFT
 * list) so manually-added tokens from one wallet/chain never bleed
 * into another and survive logout/re-import of the same account.
 * Returns `[]` when either scope component is empty (caller bootstrap
 * typically races init). Replaces the older global key which leaked
 * across accounts on switch and across networks on chain switch.
 */
function tokenListKey(blockchain: BlockchainSelection, account: string) {
  return `${toTemplateString(blockchain)}_${account.toLowerCase()}_${TOKEN_LIST_IDENTIFIER}`;
}

function hiddenTokensKey(blockchain: BlockchainSelection, account: string) {
  return `${toTemplateString(blockchain)}_${account.toLowerCase()}_${HIDDEN_TOKENS_IDENTIFIER}`;
}

function removeKeysEndingWith(suffix: string): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.endsWith(suffix)) toRemove.push(key);
  }
  toRemove.forEach((k) => {
    localStorage.removeItem(k);
  });
}

/**
 * NFT list - keyed by `${toTemplateString(blockchain)}_${account}` so collectibles from
 * one wallet/chain never bleed into another. Returns `[]` when either
 * scope component is empty (caller's bootstrap typically races init).
 * Replaces the older global key which leaked across accounts on
 * re-import and across networks on chain switch.
 */
function nftListKey(blockchain: BlockchainSelection, account: string) {
  return `${toTemplateString(blockchain)}_${account.toLowerCase()}_${NFT_LIST_IDENTIFIER}`;
}

function hiddenNftsKey(blockchain: BlockchainSelection, account: string) {
  return `${toTemplateString(blockchain)}_${account.toLowerCase()}_${HIDDEN_NFTS_IDENTIFIER}`;
}

/**
 * A utility for storing and retrieving states of different components using localStorage.
 * Data expires after 6 hours.
 */
const StorageUtil = {
  /**
   * A function for storing the active page route.
   * Call the getActivePage function to retrieve the stored value.
   */
  setActivePage: (activePage: string): Promise<void> => {
    return runAsPromise(() => {
      if (activePage) {
        setItem(ACTIVE_PAGE_IDENTIFIER, activePage);
      } else {
        localStorage.removeItem(ACTIVE_PAGE_IDENTIFIER);
      }
    });
  },

  getActivePage: (): Promise<unknown> => {
    return runAsPromise(() => {
      return getItem(ACTIVE_PAGE_IDENTIFIER) ?? "";
    });
  },

  /**
   * A function for storing the blockchain selection.
   * Call the getBlockChain function to retrieve the stored value.
   */
  setBlockChain: (selectedBlockchain: string): Promise<void> => {
    return runAsPromise(() => {
      if (IS_V3_PROFILE && selectedBlockchain !== "TEST_NET_V3")
        throw new Error("Only Testnet v3 is available in this build");
      if (!IS_V3_PROFILE && selectedBlockchain === "TEST_NET_V3")
        throw new Error("Testnet v3 requires its dedicated build");
      setItem(BLOCKCHAIN_SELECTION_IDENTIFIER, selectedBlockchain);
    });
  },

  setCreatedToken: (
    name: string,
    symbol: string,
    decimals: number,
    address: string,
    tx: string,
    blockNumber: number,
    gasUsed: number,
    effectiveGasPrice: number,
    blockHash: string,
  ): Promise<void> => {
    return runAsPromise(() => {
      setItem(BLOCKCHAIN_CREATED_TOKEN, {
        name,
        symbol,
        decimals,
        address,
        tx,
        blockNumber,
        gasUsed,
        effectiveGasPrice,
        blockHash,
      });
    });
  },

  updateTokenList: (
    blockchain: BlockchainSelection,
    account: string,
    tokenList: TokenInterface[],
  ): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      setItem(tokenListKey(blockchain, account), tokenList);
    });
  },

  getTokenList: (
    blockchain: BlockchainSelection,
    account: string,
  ): Promise<unknown> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return [];
      return getItem(tokenListKey(blockchain, account)) ?? [];
    });
  },

  clearTokenList: (
    blockchain: BlockchainSelection,
    account: string,
  ): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      localStorage.removeItem(tokenListKey(blockchain, account));
    });
  },

  /**
   * Reads the pre-per-account global token list (legacy key). Used once
   * by the migration that moves it under the active account's scope.
   */
  getLegacyGlobalTokenList: (): unknown => {
    return getItem(TOKEN_LIST_IDENTIFIER) ?? [];
  },

  /**
   * Reads the pre-per-account global hidden-tokens list (legacy key).
   */
  getLegacyGlobalHiddenTokens: (): unknown => {
    return getItem(HIDDEN_TOKENS_IDENTIFIER) ?? [];
  },

  /**
   * Removes the legacy global token + hidden-token keys after migration.
   */
  clearLegacyGlobalTokenData: (): void => {
    localStorage.removeItem(TOKEN_LIST_IDENTIFIER);
    localStorage.removeItem(HIDDEN_TOKENS_IDENTIFIER);
  },

  /**
   * Full-wipe helper: removes every account-scoped token + hidden-token
   * key (plus any legacy global keys). Used by the explicit "clear
   * wallet" flow, NOT by logout (logout intentionally preserves these so
   * re-importing the same account restores its curated token list).
   */
  clearAllTokenData(): void {
    removeKeysEndingWith(`_${TOKEN_LIST_IDENTIFIER}`);
    removeKeysEndingWith(`_${HIDDEN_TOKENS_IDENTIFIER}`);
    this.clearLegacyGlobalTokenData();
  },

  /**
   * Full-wipe helper: removes every account-scoped NFT + hidden-NFT key.
   * Used by the explicit "clear wallet" flow.
   */
  clearAllNftData: (): void => {
    removeKeysEndingWith(`_${NFT_LIST_IDENTIFIER}`);
    removeKeysEndingWith(`_${HIDDEN_NFTS_IDENTIFIER}`);
  },

  getBlockChain: (): Promise<BlockchainSelection> => {
    return runAsPromise(() => {
      if (IS_V3_PROFILE) return "TEST_NET_V3";
      const DEFAULT_BLOCKCHAIN = checkedValue(
        QRL_PROVIDER.TEST_NET.id,
        isBlockchain,
      );
      const storedBlockchain = getItem(BLOCKCHAIN_SELECTION_IDENTIFIER);
      // Guard against stale keys (e.g. "CUSTOM_RPC") that no longer exist in
      // QRL_PROVIDER - silently migrate those users to TEST_NET (default until
      // mainnet launch).
      const isValid =
        storedBlockchain != null &&
        storedBlockchain !== "TEST_NET_V3" &&
        Object.prototype.hasOwnProperty.call(
          QRL_PROVIDER,
          toTemplateString(storedBlockchain),
        );
      if (!isValid) return DEFAULT_BLOCKCHAIN;
      return checkedValue(storedBlockchain, isBlockchainSelection);
    });
  },

  /**
   * A function for storing the active account in the wallet.
   * Call the getActiveAccount function to retrieve the stored value.
   * Data expires after 6 hours on desktop web (native app bypasses expiration).
   */
  async setActiveAccount(
    blockchain: BlockchainSelection,
    activeAccount?: string,
  ) {
    const blockChainAccountIdentifier = `${toTemplateString(blockchain)}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
    if (activeAccount) {
      const normalizedActiveAccount = normalizeQrlAddress(activeAccount);
      if (!normalizedActiveAccount) {
        throw new Error("Active account must be a valid QIP-55 address");
      }
      setItem(blockChainAccountIdentifier, normalizedActiveAccount);

      // Ensure account is in the account list (default source assumed to be 'seed')
      const accountList = await this.getAccountList(blockchain);
      if (
        !accountList.some(
          (item) =>
            item.address.toLowerCase() ===
            normalizedActiveAccount.toLowerCase(),
        )
      ) {
        await this.setAccountList(blockchain, [
          ...accountList,
          { address: normalizedActiveAccount, source: "seed" },
        ]);
      }
    } else {
      localStorage.removeItem(blockChainAccountIdentifier);
    }
    dispatchStorageEvent(STORAGE_EVENT_ACTIVE_ACCOUNT);
  },

  getActiveAccount: (blockchain: BlockchainSelection): Promise<string> => {
    return runAsPromise(() => {
      const blockChainAccountIdentifier = `${toTemplateString(blockchain)}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
      return normalizeQrlAddress(getItem(blockChainAccountIdentifier)) ?? "";
    });
  },

  clearActiveAccount: (blockchain: BlockchainSelection): Promise<void> => {
    return runAsPromise(() => {
      const blockChainAccountIdentifier = `${toTemplateString(blockchain)}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
      localStorage.removeItem(blockChainAccountIdentifier);
      localStorage.removeItem(
        `${toTemplateString(blockchain)}_${LEGACY_ACTIVE_ACCOUNT_IDENTIFIER}`,
      );
      dispatchStorageEvent(STORAGE_EVENT_ACTIVE_ACCOUNT);
    });
  },

  /**
   * Stores a list of accounts along with their sources (seed or extension).
   */
  setAccountList: (
    blockchain: BlockchainSelection,
    accountList: AccountListItem[],
  ): Promise<void> => {
    return runAsPromise(() => {
      const blockChainAccountListIdentifier = `${toTemplateString(blockchain)}_${ACCOUNT_LIST_IDENTIFIER}`;
      const normalized = normalizeAccountList(accountList);
      if (normalized.length !== accountList.length) {
        throw new Error("Account list contains an invalid QIP-55 account");
      }
      setItem(blockChainAccountListIdentifier, normalized);
    });
  },

  /**
   * Retrieves the stored account list.  Returns an empty array if nothing is stored.
   * The pre-QIP-55 namespace stays isolated for rollback. Legacy Q+40 and
   * malformed records found in the QIP-55 namespace also remain stored for an
   * explicit recovery flow, while the active runtime list excludes them.
   */
  getAccountList: (
    blockchain: BlockchainSelection,
  ): Promise<AccountListItem[]> => {
    return runAsPromise(() => {
      const blockChainAccountListIdentifier = `${toTemplateString(blockchain)}_${ACCOUNT_LIST_IDENTIFIER}`;
      const data = getItem(blockChainAccountListIdentifier);

      if (!data) {
        return [];
      }

      return normalizeAccountList(data);
    });
  },

  /**
   * Returns the maximum number of wallets allowed
   */
  getMaxWallets: (): number => {
    return MAX_WALLETS;
  },

  /**
   * Checks if the wallet limit has been reached for a blockchain
   * @param blockchain The blockchain identifier
   * @returns True if the wallet limit has been reached
   */
  async isWalletLimitReached(
    blockchain: BlockchainSelection,
  ): Promise<boolean> {
    const accountList = await this.getAccountList(blockchain);
    return accountList.length >= MAX_WALLETS;
  },

  /**
   * Gets the current wallet count for a blockchain
   * @param blockchain The blockchain identifier
   * @returns The number of wallets currently stored
   */
  async getWalletCount(blockchain: BlockchainSelection): Promise<number> {
    const accountList = await this.getAccountList(blockchain);
    return accountList.length;
  },

  /**
   * A function for storing the transaction state values.
   * Only stores non-sensitive data like receiver address and amount.
   * Data expires after 6 hours.
   */
  setTransactionValues: (
    blockchain: BlockchainSelection,
    transactionValues: TransactionValuesType,
  ): Promise<void> => {
    return runAsPromise(() => {
      const transactionValuesIdentifier = `${toTemplateString(blockchain)}_${TRANSACTION_VALUES_IDENTIFIER}`;
      const safeValues = {
        receiverAddress: transactionValues.receiverAddress ?? "",
        amount: transactionValues.amount ?? 0,
      };

      setItem(transactionValuesIdentifier, safeValues);
    });
  },

  getTransactionValues: (
    blockchain: BlockchainSelection,
  ): Promise<TransactionValuesType> => {
    return runAsPromise(() => {
      const transactionValuesIdentifier = `${toTemplateString(blockchain)}_${TRANSACTION_VALUES_IDENTIFIER}`;
      return checkedValue(
        getItem(transactionValuesIdentifier) ?? {},
        isTransactionValues,
      );
    });
  },

  clearTransactionValues: (blockchain: BlockchainSelection): Promise<void> => {
    return runAsPromise(() => {
      const transactionValuesIdentifier = `${toTemplateString(blockchain)}_${TRANSACTION_VALUES_IDENTIFIER}`;
      localStorage.removeItem(transactionValuesIdentifier);
    });
  },

  setWalletSettings: (settings: WalletSettings): Promise<void> => {
    return runAsPromise(() => {
      const stored = checkedValue(
        getItem(WALLET_SETTINGS_IDENTIFIER) ?? {},
        isWalletSettings,
      );
      setItem(WALLET_SETTINGS_IDENTIFIER, { ...stored, ...settings });
      dispatchStorageEvent(STORAGE_EVENT_WALLET_SETTINGS);
    });
  },

  getWalletSettings: (): Promise<WalletSettings> => {
    return runAsPromise(() => {
      const stored = checkedValue(
        getItem(WALLET_SETTINGS_IDENTIFIER) ?? {},
        isWalletSettings,
      );
      return {
        language: stored.language,
        autoLockTimeout: stored.autoLockTimeout ?? AUTO_LOCK_TIMEOUT,
        showTokensCard: stored.showTokensCard ?? true,
        showNftsCard: stored.showNftsCard ?? true,
      };
    });
  },

  /**
   * Stores an encrypted seed for an account
   * @param blockchain The blockchain identifier
   * @param address The account address
   * @param encryptedSeed The encrypted seed data from WalletEncryptionUtil.encryptSeedWithPin
   */
  storeEncryptedSeed: (
    blockchain: BlockchainSelection,
    address: string,
    encryptedSeed: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<EncryptedSeedData & { revision?: number }> => {
    return runAsPromise(() => {
      // Defense-in-depth: on desktop the seed lives only in the isolated signer
      // and must NEVER be written to renderer localStorage. Throw loudly so any
      // missed reroute fails before persisting key material.
      if (isDesktop) {
        throw new Error(
          "desktop: encrypted seeds must never be stored in the renderer",
        );
      }
      const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const encryptedSeeds = checkedValue(
        getItem(encryptedSeedsKey) ?? [],
        isEncryptedSeedList,
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));

      // Update or add the encrypted seed
      const existingIndex = encryptedSeeds.findIndex(
        (item) =>
          stringValue(item.address).toLowerCase() === address.toLowerCase(),
      );
      const existing = encryptedSeeds[existingIndex];
      const seedData = {
        address,
        encryptedSeed,
        lastAccessed: Date.now(),
        revision: seedRevision(existing) + 1,
        walletEpoch: expectedEpoch,
      };

      if (existingIndex >= 0) {
        encryptedSeeds[existingIndex] = seedData;
      } else {
        encryptedSeeds.push(seedData);
      }

      setItemAtWalletEpoch(
        encryptedSeedsKey,
        encryptedSeeds.map((seed) => ({ ...seed, walletEpoch: expectedEpoch })),
        expectedEpoch,
      );
      return seedData;
    });
  },

  /**
   * Retrieves an encrypted seed for an account
   * @param blockchain The blockchain identifier
   * @param address The account address
   * @returns The encrypted seed data or null if not found
   */
  getEncryptedSeed: (
    blockchain: BlockchainSelection,
    address: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<unknown> => {
    return runAsPromise(() => {
      const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const encryptedSeeds = checkedValue(
        getItem(encryptedSeedsKey) ?? [],
        isEncryptedSeedList,
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));

      const seedIndex = encryptedSeeds.findIndex(
        (item) =>
          stringValue(item.address).toLowerCase() === address.toLowerCase(),
      );
      const seedData = encryptedSeeds[seedIndex];
      if (seedData) {
        // A read must not create a new backup revision. Only touch the local
        // expiry timestamp while preserving the ciphertext's identity.
        encryptedSeeds[seedIndex] = {
          ...seedData,
          lastAccessed: Date.now(),
          walletEpoch: expectedEpoch,
        };
        setItemAtWalletEpoch(
          encryptedSeedsKey,
          encryptedSeeds.map((seed) => ({
            ...seed,
            walletEpoch: expectedEpoch,
          })),
          expectedEpoch,
        );
        return seedData.encryptedSeed;
      }

      return null;
    });
  },

  /**
   * Retrieves all encrypted seeds for a blockchain
   * @param blockchain The blockchain identifier
   * @returns Array of all stored encrypted seeds
   */
  getAllEncryptedSeeds: (
    blockchain: BlockchainSelection,
  ): Promise<EncryptedSeedData[]> => {
    return runAsPromise(() => {
      const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const epoch = getWalletEpoch();
      return checkedValue(
        getItem(encryptedSeedsKey) ?? [],
        isEncryptedSeedList,
      ).filter((seed) => seedBelongsToEpoch(seed, epoch));
    });
  },

  /**
   * Checks if any encrypted seeds exist for a blockchain
   * @param blockchain The blockchain identifier
   * @returns True if at least one encrypted seed exists
   */
  async hasEncryptedSeeds(blockchain: BlockchainSelection): Promise<boolean> {
    const seeds = await this.getAllEncryptedSeeds(blockchain);
    return seeds.length > 0;
  },

  /**
   * Updates all encrypted seeds for a blockchain atomically
   * Used when changing PIN - replaces all encrypted seeds with newly encrypted versions
   * @param blockchain The blockchain identifier
   * @param seeds Array of updated encrypted seed data
   */
  updateAllEncryptedSeeds: (
    blockchain: BlockchainSelection,
    seeds: EncryptedSeedData[],
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<void> => {
    return runAsPromise(() => {
      const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      setItemAtWalletEpoch(
        encryptedSeedsKey,
        seeds.map((seed) => ({ ...seed, walletEpoch: expectedEpoch })),
        expectedEpoch,
      );
    });
  },

  /**
   * Replace one blockchain's complete encrypted-seed set only if it is still
   * byte-for-byte the snapshot the caller prepared against. PIN rotation does
   * expensive asynchronous KDF work before writing; this compare-and-swap
   * prevents it from clobbering an account import or another rotation that won
   * during those awaits.
   */
  replaceEncryptedSeedSetIfUnchanged: (
    blockchain: BlockchainSelection,
    expected: EncryptedSeedData[],
    replacement: EncryptedSeedData[],
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<boolean> => {
    return runAsPromise(() => {
      if (!isWalletEpochCurrent(expectedEpoch)) return false;
      const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const current = checkedValue(
        getItem(encryptedSeedsKey) ?? [],
        isEncryptedSeedList,
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));
      if (!encryptedSeedSetsEqual(current, expected)) return false;
      setItemAtWalletEpoch(
        encryptedSeedsKey,
        replacement.map((seed) => ({ ...seed, walletEpoch: expectedEpoch })),
        expectedEpoch,
      );
      return true;
    });
  },

  /**
   * Merge a native restore record without ever replacing an equal/newer local
   * record. Missing legacy records are revision 0; a revision-0 native backup
   * therefore restores only into an empty slot and can never overwrite live
   * browser state.
   */
  restoreEncryptedSeedIfNewer: (
    blockchain: BlockchainSelection,
    address: string,
    encryptedSeed: string,
    revision: number,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<"stored" | "skipped"> => {
    return runAsPromise(() => {
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new Error("Invalid encrypted seed revision");
      }
      const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const encryptedSeeds = checkedValue(
        getItem(encryptedSeedsKey) ?? [],
        isEncryptedSeedList,
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));
      const existingIndex = encryptedSeeds.findIndex(
        (item) =>
          stringValue(item.address).toLowerCase() === address.toLowerCase(),
      );
      const existing = encryptedSeeds[existingIndex];
      if (existing && seedRevision(existing) >= revision) return "skipped";

      const restored: EncryptedSeedData = {
        address,
        encryptedSeed,
        lastAccessed: Date.now(),
        revision,
        walletEpoch: expectedEpoch,
      };
      if (existingIndex >= 0) encryptedSeeds[existingIndex] = restored;
      else encryptedSeeds.push(restored);
      setItemAtWalletEpoch(
        encryptedSeedsKey,
        encryptedSeeds.map((seed) => ({ ...seed, walletEpoch: expectedEpoch })),
        expectedEpoch,
      );
      return "stored";
    });
  },

  /**
   * Replace a legacy encrypted seed only if it has not changed since it was
   * decrypted. This compare-and-swap prevents a lazy v4 migration from
   * overwriting a concurrent PIN change or account replacement.
   */
  migrateEncryptedSeed: (
    blockchain: BlockchainSelection,
    address: unknown,
    expectedEncryptedSeed: unknown,
    migratedEncryptedSeed: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<(EncryptedSeedData & { revision?: number }) | null> => {
    return runAsPromise(() => {
      if (!isWalletEpochCurrent(expectedEpoch)) return null;
      const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const encryptedSeeds = checkedValue(
        getItem(encryptedSeedsKey) ?? [],
        isEncryptedSeedList,
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));
      const existingIndex = encryptedSeeds.findIndex(
        (item) =>
          stringValue(item.address).toLowerCase() ===
          stringValue(address).toLowerCase(),
      );
      const existing = encryptedSeeds[existingIndex];
      if (!existing || existing.encryptedSeed !== expectedEncryptedSeed)
        return null;

      const migrated = {
        ...existing,
        encryptedSeed: migratedEncryptedSeed,
        lastAccessed: Date.now(),
        revision: seedRevision(existing) + 1,
        walletEpoch: expectedEpoch,
      };
      encryptedSeeds[existingIndex] = migrated;
      setItemAtWalletEpoch(
        encryptedSeedsKey,
        encryptedSeeds.map((seed) => ({ ...seed, walletEpoch: expectedEpoch })),
        expectedEpoch,
      );
      return migrated;
    });
  },

  /**
   * Removes an encrypted seed for an account
   * @param blockchain The blockchain identifier
   * @param address The account address
   */
  removeEncryptedSeed: (
    blockchain: BlockchainSelection,
    address: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<void> => {
    return runAsPromise(() => {
      const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      let encryptedSeeds = checkedValue(
        getItem(encryptedSeedsKey) ?? [],
        isEncryptedSeedList,
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));

      encryptedSeeds = encryptedSeeds.filter(
        (item) => item.address !== address,
      );
      setItemAtWalletEpoch(
        encryptedSeedsKey,
        encryptedSeeds.map((seed) => ({ ...seed, walletEpoch: expectedEpoch })),
        expectedEpoch,
      );
    });
  },

  /**
   * Removes all encrypted seeds that have not been accessed within the auto-lock timeout period
   * @param blockchain The blockchain identifier
   */
  async cleanupExpiredSeeds(
    blockchain: BlockchainSelection,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ) {
    const settings = await this.getWalletSettings();
    const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    let encryptedSeeds = checkedValue(
      getItem(encryptedSeedsKey) ?? [],
      isEncryptedSeedList,
    ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));

    const now = Date.now();
    encryptedSeeds = encryptedSeeds.filter(
      (item) =>
        now - Number(item.lastAccessed) < toNumber(settings.autoLockTimeout),
    );

    setItemAtWalletEpoch(
      encryptedSeedsKey,
      encryptedSeeds.map((seed) => ({ ...seed, walletEpoch: expectedEpoch })),
      expectedEpoch,
    );
  },

  /**
   * Clears ALL encrypted seeds for a blockchain (used by native app wallet removal)
   * @param blockchain The blockchain identifier
   */
  clearAllEncryptedSeeds: (blockchain: BlockchainSelection): void => {
    const encryptedSeedsKey = `${toTemplateString(blockchain)}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    localStorage.removeItem(encryptedSeedsKey);
  },

  /**
   * Clears the account list for a blockchain
   * @param blockchain The blockchain identifier
   */
  clearAccountList: (blockchain: BlockchainSelection): void => {
    const blockChainAccountListIdentifier = `${toTemplateString(blockchain)}_${ACCOUNT_LIST_IDENTIFIER}`;
    localStorage.removeItem(blockChainAccountListIdentifier);
    localStorage.removeItem(
      `${toTemplateString(blockchain)}_${LEGACY_ACCOUNT_LIST_IDENTIFIER}`,
    );
  },

  /**
   * Get list of hidden token addresses for an account scope.
   */
  getHiddenTokens: (
    blockchain: BlockchainSelection,
    account: string,
  ): Promise<unknown> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return [];
      return getItem(hiddenTokensKey(blockchain, account)) ?? [];
    });
  },

  /**
   * Add a token address to the hidden list
   */
  async hideToken(
    blockchain: BlockchainSelection,
    account: string,
    tokenAddress: string,
  ) {
    if (!blockchain || !account) return;
    const hiddenTokens = await this.getHiddenTokens(blockchain, account);
    if (
      !arrayValue(hiddenTokens).some(
        (addr) =>
          stringValue(addr).toLowerCase() === tokenAddress.toLowerCase(),
      )
    ) {
      arrayValue(hiddenTokens).push(tokenAddress.toLowerCase());
      setItem(hiddenTokensKey(blockchain, account), hiddenTokens);
    }
  },

  /**
   * Remove a token address from the hidden list
   */
  async unhideToken(
    blockchain: BlockchainSelection,
    account: string,
    tokenAddress: string,
  ) {
    if (!blockchain || !account) return;
    let hiddenTokens = await this.getHiddenTokens(blockchain, account);
    hiddenTokens = arrayValue(hiddenTokens).filter(
      (addr) => stringValue(addr).toLowerCase() !== tokenAddress.toLowerCase(),
    );
    setItem(hiddenTokensKey(blockchain, account), hiddenTokens);
  },

  setBalanceCache: (
    blockchain: BlockchainSelection,
    balances: Record<string, unknown>,
  ): Promise<void> => {
    return runAsPromise(() => {
      const key = `${toTemplateString(blockchain)}_${BALANCE_CACHE_IDENTIFIER}`;
      setItem(key, balances);
    });
  },

  getBalanceCache: (
    blockchain: BlockchainSelection,
  ): Promise<Record<string, unknown>> => {
    return runAsPromise(() => {
      const key = `${toTemplateString(blockchain)}_${BALANCE_CACHE_IDENTIFIER}`;
      return checkedValue(getItem(key) ?? {}, isBalanceCache);
    });
  },

  /**
   * Clear all hidden tokens for an account scope (re-show all).
   */
  clearHiddenTokens: (
    blockchain: BlockchainSelection,
    account: string,
  ): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      localStorage.removeItem(hiddenTokensKey(blockchain, account));
    });
  },

  getNftList: (
    blockchain: BlockchainSelection,
    account: string,
  ): Promise<unknown> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return [];
      return getItem(nftListKey(blockchain, account)) ?? [];
    });
  },

  updateNftList: (
    blockchain: BlockchainSelection,
    account: string,
    list: unknown,
  ): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      setItem(nftListKey(blockchain, account), list);
    });
  },

  clearNftList: (
    blockchain: BlockchainSelection,
    account: string,
  ): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      localStorage.removeItem(nftListKey(blockchain, account));
    });
  },

  getHiddenNfts: (
    blockchain: BlockchainSelection,
    account: string,
  ): Promise<unknown> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return [];
      return getItem(hiddenNftsKey(blockchain, account)) ?? [];
    });
  },

  async hideNft(blockchain: BlockchainSelection, account: string, key: string) {
    if (!blockchain || !account) return;
    const list = await this.getHiddenNfts(blockchain, account);
    if (
      !arrayValue(list).some(
        (k) => stringValue(k).toLowerCase() === key.toLowerCase(),
      )
    ) {
      arrayValue(list).push(key.toLowerCase());
      setItem(hiddenNftsKey(blockchain, account), list);
    }
  },

  async unhideNft(
    blockchain: BlockchainSelection,
    account: string,
    key: string,
  ) {
    if (!blockchain || !account) return;
    let list = await this.getHiddenNfts(blockchain, account);
    list = arrayValue(list).filter(
      (k) => stringValue(k).toLowerCase() !== key.toLowerCase(),
    );
    setItem(hiddenNftsKey(blockchain, account), list);
  },

  clearHiddenNfts: (
    blockchain: BlockchainSelection,
    account: string,
  ): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      localStorage.removeItem(hiddenNftsKey(blockchain, account));
    });
  },
};

export default StorageUtil;
