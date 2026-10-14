import { runAsPromise } from "@/utils/runAsPromise";
import { isRecord } from "@/utils/guards";
import { QRL_PROVIDER } from "@/config";
import type { TokenInterface, NFTInterface } from "@/constants";
import { isInNativeApp } from "@/utils/nativeApp";
import { isDesktop } from "@/desktop/bridge";
import {
  getWalletEpoch,
  INITIAL_WALLET_EPOCH,
  isWalletEpochCurrent,
  type WalletEpoch,
} from "@/utils/walletEpoch";
import { normalizeQrlAddress } from "@/utils/web3/address";
import { IS_V3_PROFILE, profileStorageKey } from '@/config/runtimeProfile';

const ACTIVE_PAGE_IDENTIFIER = profileStorageKey("ACTIVE_PAGE");
const BLOCKCHAIN_SELECTION_IDENTIFIER = profileStorageKey("BLOCKCHAIN_SELECTION");
const BLOCKCHAIN_CREATED_TOKEN = profileStorageKey("CREATED_TOKEN");
const ACTIVE_ACCOUNT_IDENTIFIER = "QIP55_ACTIVE_ACCOUNT";
const ACCOUNT_LIST_IDENTIFIER = "QIP55_ACCOUNT_LIST";
const LEGACY_ACTIVE_ACCOUNT_IDENTIFIER = "ACTIVE_ACCOUNT";
const LEGACY_ACCOUNT_LIST_IDENTIFIER = "ACCOUNT_LIST";
const TRANSACTION_VALUES_IDENTIFIER = "TRANSACTION_VALUES";
const TOKEN_LIST_IDENTIFIER = IS_V3_PROFILE ? "TOKEN_LIST_V3" : "TOKEN_LIST";
const HIDDEN_TOKENS_IDENTIFIER = IS_V3_PROFILE ? "HIDDEN_TOKENS_V3" : "HIDDEN_TOKENS";
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
  receiverAddress?: string;
  amount?: number;
};

type BlockchainType = keyof typeof QRL_PROVIDER;

interface StorageItem<T> {
  value: T;
  timestamp: number;
  version: string;
}

interface WalletSettings {
  autoLockTimeout: number;
  showTokensCard: boolean;
  showNftsCard: boolean;
}

export interface EncryptedSeedData {
  address: string;
  encryptedSeed: string; // JSON string from WalletEncryptionUtil.encryptSeedWithPin
  lastAccessed: number;
  /**
   * Monotonic per-(blockchain,address) revision used by the native backup
   * protocol. Records written before the acknowledged-backup protocol have no
   * revision and are treated as revision 0.
   */
  revision?: number;
  /** Wallet identity generation that is allowed to read this ciphertext. */
  walletEpoch?: WalletEpoch;
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

function isExpired(timestamp: number): boolean {
  // Native app has its own security (Device Login, auto-lock on background)
  // so we don't need the 6-hour expiration guardrail there
  if (isInNativeApp()) {
    return false;
  }
  return Date.now() - timestamp > MAX_STORAGE_AGE;
}

function getItem<T>(key: string): T | null {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;

    const parsed = JSON.parse(item) as StorageItem<T>;

    // Check expiration
    if (isExpired(parsed.timestamp)) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
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
 * Token list - keyed by `${blockchain}_${account}` (mirrors the NFT
 * list) so manually-added tokens from one wallet/chain never bleed
 * into another and survive logout/re-import of the same account.
 * Returns `[]` when either scope component is empty (caller bootstrap
 * typically races init). Replaces the older global key which leaked
 * across accounts on switch and across networks on chain switch.
 */
function tokenListKey(blockchain: string, account: string) {
  return `${blockchain}_${account.toLowerCase()}_${TOKEN_LIST_IDENTIFIER}`;
}

function hiddenTokensKey(blockchain: string, account: string) {
  return `${blockchain}_${account.toLowerCase()}_${HIDDEN_TOKENS_IDENTIFIER}`;
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
 * NFT list - keyed by `${blockchain}_${account}` so collectibles from
 * one wallet/chain never bleed into another. Returns `[]` when either
 * scope component is empty (caller's bootstrap typically races init).
 * Replaces the older global key which leaked across accounts on
 * re-import and across networks on chain switch.
 */
function nftListKey(blockchain: string, account: string) {
  return `${blockchain}_${account.toLowerCase()}_${NFT_LIST_IDENTIFIER}`;
}

function hiddenNftsKey(blockchain: string, account: string) {
  return `${blockchain}_${account.toLowerCase()}_${HIDDEN_NFTS_IDENTIFIER}`;
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

  getActivePage: (): Promise<string> => {
    return runAsPromise(() => {
      return getItem<string>(ACTIVE_PAGE_IDENTIFIER) ?? "";
    });
  },

  /**
   * A function for storing the blockchain selection.
   * Call the getBlockChain function to retrieve the stored value.
   */
  setBlockChain: (selectedBlockchain: string): Promise<void> => {
    return runAsPromise(() => {
      if (IS_V3_PROFILE && selectedBlockchain !== 'TEST_NET_V3') throw new Error('Only Testnet v3 is available in this build');
      if (!IS_V3_PROFILE && selectedBlockchain === 'TEST_NET_V3') throw new Error('Testnet v3 requires its dedicated build');
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
    blockchain: string,
    account: string,
    tokenList: TokenInterface[],
  ): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      setItem(tokenListKey(blockchain, account), tokenList);
    });
  },

  getTokenList: (blockchain: string, account: string): Promise<TokenInterface[]> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return [];
      return (
        getItem<TokenInterface[]>(tokenListKey(blockchain, account)) ??
        []
      );
    });
  },

  clearTokenList: (blockchain: string, account: string): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      localStorage.removeItem(tokenListKey(blockchain, account));
    });
  },

  /**
   * Reads the pre-per-account global token list (legacy key). Used once
   * by the migration that moves it under the active account's scope.
   */
  getLegacyGlobalTokenList: (): TokenInterface[] => {
    return getItem<TokenInterface[]>(TOKEN_LIST_IDENTIFIER) ?? [];
  },

  /**
   * Reads the pre-per-account global hidden-tokens list (legacy key).
   */
  getLegacyGlobalHiddenTokens: (): string[] => {
    return getItem<string[]>(HIDDEN_TOKENS_IDENTIFIER) ?? [];
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

  getBlockChain: (): Promise<BlockchainType> => {
    return runAsPromise(() => {
      if (IS_V3_PROFILE) return 'TEST_NET_V3';
      const DEFAULT_BLOCKCHAIN = QRL_PROVIDER.TEST_NET.id;
      const storedBlockchain = getItem<string>(
        BLOCKCHAIN_SELECTION_IDENTIFIER,
      );
      // Guard against stale keys (e.g. "CUSTOM_RPC") that no longer exist in
      // QRL_PROVIDER - silently migrate those users to TEST_NET (default until
      // mainnet launch).
      const isValid =
        storedBlockchain != null && storedBlockchain !== 'TEST_NET_V3' &&
        Object.prototype.hasOwnProperty.call(QRL_PROVIDER, storedBlockchain);
      return (isValid ? storedBlockchain : DEFAULT_BLOCKCHAIN) as BlockchainType;
    });
  },

  /**
   * A function for storing the active account in the wallet.
   * Call the getActiveAccount function to retrieve the stored value.
   * Data expires after 6 hours on desktop web (native app bypasses expiration).
   */
  async setActiveAccount(blockchain: string, activeAccount?: string) {
    const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
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
            item.address.toLowerCase() === normalizedActiveAccount.toLowerCase(),
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

  getActiveAccount: (blockchain: string): Promise<string> => {
    return runAsPromise(() => {
      const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
      return normalizeQrlAddress(getItem<unknown>(blockChainAccountIdentifier)) ?? "";
    });
  },

  clearActiveAccount: (blockchain: string): Promise<void> => {
    return runAsPromise(() => {
      const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
      localStorage.removeItem(blockChainAccountIdentifier);
      localStorage.removeItem(
        `${blockchain}_${LEGACY_ACTIVE_ACCOUNT_IDENTIFIER}`,
      );
      dispatchStorageEvent(STORAGE_EVENT_ACTIVE_ACCOUNT);
    });
  },

  /**
   * Stores a list of accounts along with their sources (seed or extension).
   */
  setAccountList: (
    blockchain: string,
    accountList: AccountListItem[],
  ): Promise<void> => {
    return runAsPromise(() => {
      const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
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
  getAccountList: (blockchain: string): Promise<AccountListItem[]> => {
    return runAsPromise(() => {
      const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
      const data = getItem<unknown>(blockChainAccountListIdentifier);

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
  async isWalletLimitReached(blockchain: string): Promise<boolean> {
    const accountList = await this.getAccountList(blockchain);
    return accountList.length >= MAX_WALLETS;
  },

  /**
   * Gets the current wallet count for a blockchain
   * @param blockchain The blockchain identifier
   * @returns The number of wallets currently stored
   */
  async getWalletCount(blockchain: string): Promise<number> {
    const accountList = await this.getAccountList(blockchain);
    return accountList.length;
  },

  /**
   * A function for storing the transaction state values.
   * Only stores non-sensitive data like receiver address and amount.
   * Data expires after 6 hours.
   */
  setTransactionValues: (
    blockchain: string,
    transactionValues: TransactionValuesType,
  ): Promise<void> => {
    return runAsPromise(() => {
      const transactionValuesIdentifier = `${blockchain}_${TRANSACTION_VALUES_IDENTIFIER}`;
      const safeValues = {
        receiverAddress: transactionValues.receiverAddress ?? "",
        amount: transactionValues.amount ?? 0,
      };

      setItem(transactionValuesIdentifier, safeValues);
    });
  },

  getTransactionValues: (blockchain: string): Promise<TransactionValuesType> => {
    return runAsPromise(() => {
      const transactionValuesIdentifier = `${blockchain}_${TRANSACTION_VALUES_IDENTIFIER}`;
      return (
        getItem<TransactionValuesType>(transactionValuesIdentifier) ?? {}
      );
    });
  },

  clearTransactionValues: (blockchain: string): Promise<void> => {
    return runAsPromise(() => {
      const transactionValuesIdentifier = `${blockchain}_${TRANSACTION_VALUES_IDENTIFIER}`;
      localStorage.removeItem(transactionValuesIdentifier);
    });
  },

  setWalletSettings: (settings: WalletSettings): Promise<void> => {
    return runAsPromise(() => {
      setItem(WALLET_SETTINGS_IDENTIFIER, settings);
      dispatchStorageEvent(STORAGE_EVENT_WALLET_SETTINGS);
    });
  },

  getWalletSettings: (): Promise<WalletSettings> => {
    return runAsPromise(() => {
      const stored =
        getItem<Partial<WalletSettings>>(WALLET_SETTINGS_IDENTIFIER) ?? {};
      return {
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
    blockchain: string,
    address: string,
    encryptedSeed: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<EncryptedSeedData> => {
    return runAsPromise(() => {
      // Defense-in-depth: on desktop the seed lives only in the isolated signer
      // and must NEVER be written to renderer localStorage. Throw loudly so any
      // missed reroute fails before persisting key material.
      if (isDesktop) {
        throw new Error(
          "desktop: encrypted seeds must never be stored in the renderer",
        );
      }
      const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const encryptedSeeds = (
        getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? []
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));

      // Update or add the encrypted seed
      const existingIndex = encryptedSeeds.findIndex(
        (item) => item.address.toLowerCase() === address.toLowerCase(),
      );
      const existing = encryptedSeeds[existingIndex];
      const seedData: EncryptedSeedData = {
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
    blockchain: string,
    address: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<string | null> => {
    return runAsPromise(() => {
      const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const encryptedSeeds = (
        getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? []
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));

      const seedIndex = encryptedSeeds.findIndex(
        (item) => item.address.toLowerCase() === address.toLowerCase(),
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
          encryptedSeeds.map((seed) => ({ ...seed, walletEpoch: expectedEpoch })),
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
    blockchain: string,
  ): Promise<EncryptedSeedData[]> => {
    return runAsPromise(() => {
      const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const epoch = getWalletEpoch();
      return (getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? []).filter(
        (seed) => seedBelongsToEpoch(seed, epoch),
      );
    });
  },

  /**
   * Checks if any encrypted seeds exist for a blockchain
   * @param blockchain The blockchain identifier
   * @returns True if at least one encrypted seed exists
   */
  async hasEncryptedSeeds(blockchain: string): Promise<boolean> {
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
    blockchain: string,
    seeds: EncryptedSeedData[],
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<void> => {
    return runAsPromise(() => {
      const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
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
    blockchain: string,
    expected: EncryptedSeedData[],
    replacement: EncryptedSeedData[],
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<boolean> => {
    return runAsPromise(() => {
      if (!isWalletEpochCurrent(expectedEpoch)) return false;
      const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const current = (
        getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? []
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
    blockchain: string,
    address: string,
    encryptedSeed: string,
    revision: number,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<"stored" | "skipped"> => {
    return runAsPromise(() => {
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new Error("Invalid encrypted seed revision");
      }
      const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const encryptedSeeds = (
        getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? []
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));
      const existingIndex = encryptedSeeds.findIndex(
        (item) => item.address.toLowerCase() === address.toLowerCase(),
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
    blockchain: string,
    address: string,
    expectedEncryptedSeed: string,
    migratedEncryptedSeed: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<EncryptedSeedData | null> => {
    return runAsPromise(() => {
      if (!isWalletEpochCurrent(expectedEpoch)) return null;
      const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      const encryptedSeeds = (
        getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? []
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));
      const existingIndex = encryptedSeeds.findIndex(
        (item) => item.address.toLowerCase() === address.toLowerCase(),
      );
      const existing = encryptedSeeds[existingIndex];
      if (!existing || existing.encryptedSeed !== expectedEncryptedSeed)
        return null;

      const migrated: EncryptedSeedData = {
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
    blockchain: string,
    address: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ): Promise<void> => {
    return runAsPromise(() => {
      const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
      let encryptedSeeds = (
        getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? []
      ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));

      encryptedSeeds = encryptedSeeds.filter((item) => item.address !== address);
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
    blockchain: string,
    expectedEpoch: WalletEpoch = getWalletEpoch(),
  ) {
    const settings = await this.getWalletSettings();
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    let encryptedSeeds = (
      getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? []
    ).filter((seed) => seedBelongsToEpoch(seed, expectedEpoch));

    const now = Date.now();
    encryptedSeeds = encryptedSeeds.filter(
      (item) => now - item.lastAccessed < settings.autoLockTimeout,
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
  clearAllEncryptedSeeds: (blockchain: string): void => {
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    localStorage.removeItem(encryptedSeedsKey);
  },

  /**
   * Clears the account list for a blockchain
   * @param blockchain The blockchain identifier
   */
  clearAccountList: (blockchain: string): void => {
    const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
    localStorage.removeItem(blockChainAccountListIdentifier);
    localStorage.removeItem(`${blockchain}_${LEGACY_ACCOUNT_LIST_IDENTIFIER}`);
  },

  /**
   * Get list of hidden token addresses for an account scope.
   */
  getHiddenTokens: (
    blockchain: string,
    account: string,
  ): Promise<string[]> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return [];
      return (
        getItem<string[]>(hiddenTokensKey(blockchain, account)) ?? []
      );
    });
  },

  /**
   * Add a token address to the hidden list
   */
  async hideToken(
    blockchain: string,
    account: string,
    tokenAddress: string,
  ) {
    if (!blockchain || !account) return;
    const hiddenTokens = await this.getHiddenTokens(blockchain, account);
    if (
      !hiddenTokens.some(
        (addr) => addr.toLowerCase() === tokenAddress.toLowerCase(),
      )
    ) {
      hiddenTokens.push(tokenAddress.toLowerCase());
      setItem(hiddenTokensKey(blockchain, account), hiddenTokens);
    }
  },

  /**
   * Remove a token address from the hidden list
   */
  async unhideToken(
    blockchain: string,
    account: string,
    tokenAddress: string,
  ) {
    if (!blockchain || !account) return;
    let hiddenTokens = await this.getHiddenTokens(blockchain, account);
    hiddenTokens = hiddenTokens.filter(
      (addr) => addr.toLowerCase() !== tokenAddress.toLowerCase(),
    );
    setItem(hiddenTokensKey(blockchain, account), hiddenTokens);
  },

  setBalanceCache: (
    blockchain: string,
    balances: Record<string, string>,
  ): Promise<void> => {
    return runAsPromise(() => {
      const key = `${blockchain}_${BALANCE_CACHE_IDENTIFIER}`;
      setItem(key, balances);
    });
  },

  getBalanceCache: (
    blockchain: string,
  ): Promise<Record<string, string>> => {
    return runAsPromise(() => {
      const key = `${blockchain}_${BALANCE_CACHE_IDENTIFIER}`;
      return getItem<Record<string, string>>(key) ?? {};
    });
  },

  /**
   * Clear all hidden tokens for an account scope (re-show all).
   */
  clearHiddenTokens: (blockchain: string, account: string): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      localStorage.removeItem(hiddenTokensKey(blockchain, account));
    });
  },

  getNftList: (
    blockchain: string,
    account: string,
  ): Promise<NFTInterface[]> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return [];
      return (
        getItem<NFTInterface[]>(nftListKey(blockchain, account)) ?? []
      );
    });
  },

  updateNftList: (
    blockchain: string,
    account: string,
    list: NFTInterface[],
  ): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      setItem(nftListKey(blockchain, account), list);
    });
  },

  clearNftList: (blockchain: string, account: string): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      localStorage.removeItem(nftListKey(blockchain, account));
    });
  },

  getHiddenNfts: (
    blockchain: string,
    account: string,
  ): Promise<string[]> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return [];
      return (
        getItem<string[]>(hiddenNftsKey(blockchain, account)) ?? []
      );
    });
  },

  async hideNft(blockchain: string, account: string, key: string) {
    if (!blockchain || !account) return;
    const list = await this.getHiddenNfts(blockchain, account);
    if (!list.some((k) => k.toLowerCase() === key.toLowerCase())) {
      list.push(key.toLowerCase());
      setItem(hiddenNftsKey(blockchain, account), list);
    }
  },

  async unhideNft(blockchain: string, account: string, key: string) {
    if (!blockchain || !account) return;
    let list = await this.getHiddenNfts(blockchain, account);
    list = list.filter((k) => k.toLowerCase() !== key.toLowerCase());
    setItem(hiddenNftsKey(blockchain, account), list);
  },

  clearHiddenNfts: (blockchain: string, account: string): Promise<void> => {
    return runAsPromise(() => {
      if (!blockchain || !account) return;
      localStorage.removeItem(hiddenNftsKey(blockchain, account));
    });
  },
};

export default StorageUtil;
