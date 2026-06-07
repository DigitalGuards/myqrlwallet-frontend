import { QRL_PROVIDER } from "@/config";
import type { TokenInterface, NFTInterface } from "@/constants";
import { isInNativeApp } from "@/utils/nativeApp";

const ACTIVE_PAGE_IDENTIFIER = "ACTIVE_PAGE";
const BLOCKCHAIN_SELECTION_IDENTIFIER = "BLOCKCHAIN_SELECTION";
const BLOCKCHAIN_CREATED_TOKEN = "CREATED_TOKEN";
const ACTIVE_ACCOUNT_IDENTIFIER = "ACTIVE_ACCOUNT";
const ACCOUNT_LIST_IDENTIFIER = "ACCOUNT_LIST";
const TRANSACTION_VALUES_IDENTIFIER = "TRANSACTION_VALUES";
const TOKEN_LIST_IDENTIFIER = "TOKEN_LIST";
const HIDDEN_TOKENS_IDENTIFIER = "HIDDEN_TOKENS";
const NFT_LIST_IDENTIFIER = "NFT_LIST";
const HIDDEN_NFTS_IDENTIFIER = "HIDDEN_NFTS";
const BALANCE_CACHE_IDENTIFIER = "BALANCE_CACHE";
const STORAGE_VERSION = 'v1';
const MAX_STORAGE_AGE = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const MAX_WALLETS = 10; // Maximum number of wallets that can be imported
const WALLET_SETTINGS_IDENTIFIER = "WALLET_SETTINGS";
const ENCRYPTED_SEEDS_IDENTIFIER = "ENCRYPTED_SEEDS";
const AUTO_LOCK_TIMEOUT = 15 * 60 * 1000; // 15 minutes default auto-lock timeout

// Same-tab change events. The native `storage` event only fires in OTHER
// tabs, so we dispatch these on `window` to let other modules
// (e.g. autoLock) react to writes happening in the same tab without
// monkey-patching `localStorage.setItem`. Guarded against environments
// where `window` is undefined (SSR / tests).
export const STORAGE_EVENT_ACTIVE_ACCOUNT = 'qrl-wallet:active-account-changed';
export const STORAGE_EVENT_WALLET_SETTINGS = 'qrl-wallet:wallet-settings-changed';
const dispatchStorageEvent = (name: string) => {
  if (typeof window !== 'undefined') {
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
}

// New type to track the source (seed vs extension) for an account stored in ACCOUNT_LIST
export type AccountSource = 'seed' | 'extension';

export interface AccountListItem {
  address: string;
  source: AccountSource;
}

/**
 * A utility for storing and retrieving states of different components using localStorage.
 * Data expires after 6 hours.
 */
class StorageUtil {
  private static wrapWithMetadata<T>(value: T): StorageItem<T> {
    return {
      value,
      timestamp: Date.now(),
      version: STORAGE_VERSION
    };
  }

  private static isExpired(timestamp: number): boolean {
    // Native app has its own security (Device Login, auto-lock on background)
    // so we don't need the 6-hour expiration guardrail there
    if (isInNativeApp()) {
      return false;
    }
    return Date.now() - timestamp > MAX_STORAGE_AGE;
  }

  private static getItem<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;

      const parsed = JSON.parse(item) as StorageItem<T>;

      // Check expiration
      if (this.isExpired(parsed.timestamp)) {
        localStorage.removeItem(key);
        return null;
      }

      return parsed.value;
    } catch {
      return null;
    }
  }

  private static setItem<T>(key: string, value: T): void {
    const item = this.wrapWithMetadata(value);
    localStorage.setItem(key, JSON.stringify(item));
  }

  /**
   * A function for storing the active page route.
   * Call the getActivePage function to retrieve the stored value.
   */
  static async setActivePage(activePage: string) {
    if (activePage) {
      this.setItem(ACTIVE_PAGE_IDENTIFIER, activePage);
    } else {
      localStorage.removeItem(ACTIVE_PAGE_IDENTIFIER);
    }
  }

  static async getActivePage() {
    return this.getItem<string>(ACTIVE_PAGE_IDENTIFIER) ?? "";
  }

  /**
   * A function for storing the blockchain selection.
   * Call the getBlockChain function to retrieve the stored value.
   */
  static async setBlockChain(selectedBlockchain: string) {
    this.setItem(BLOCKCHAIN_SELECTION_IDENTIFIER, selectedBlockchain);
  }

  static async setCreatedToken(name: string, symbol: string, decimals: number, address: string, tx: string, blockNumber: number, gasUsed: number, effectiveGasPrice: number, blockHash: string) {
    this.setItem(BLOCKCHAIN_CREATED_TOKEN, { name, symbol, decimals, address, tx, blockNumber, gasUsed, effectiveGasPrice, blockHash });
  }

  /**
   * Token list — keyed by `${blockchain}_${account}` (mirrors the NFT
   * list) so manually-added tokens from one wallet/chain never bleed
   * into another and survive logout/re-import of the same account.
   * Returns `[]` when either scope component is empty (caller bootstrap
   * typically races init). Replaces the older global key which leaked
   * across accounts on switch and across networks on chain switch.
   */
  private static tokenListKey(blockchain: string, account: string) {
    return `${blockchain}_${account.toLowerCase()}_${TOKEN_LIST_IDENTIFIER}`;
  }

  private static hiddenTokensKey(blockchain: string, account: string) {
    return `${blockchain}_${account.toLowerCase()}_${HIDDEN_TOKENS_IDENTIFIER}`;
  }

  static async updateTokenList(blockchain: string, account: string, tokenList: TokenInterface[]) {
    if (!blockchain || !account) return;
    this.setItem(this.tokenListKey(blockchain, account), tokenList);
  }

  static async getTokenList(blockchain: string, account: string) {
    if (!blockchain || !account) return [];
    return this.getItem<TokenInterface[]>(this.tokenListKey(blockchain, account)) ?? [];
  }

  static async clearTokenList(blockchain: string, account: string) {
    if (!blockchain || !account) return;
    localStorage.removeItem(this.tokenListKey(blockchain, account));
  }

  /**
   * Reads the pre-per-account global token list (legacy key). Used once
   * by the migration that moves it under the active account's scope.
   */
  static getLegacyGlobalTokenList(): TokenInterface[] {
    return this.getItem<TokenInterface[]>(TOKEN_LIST_IDENTIFIER) ?? [];
  }

  /**
   * Reads the pre-per-account global hidden-tokens list (legacy key).
   */
  static getLegacyGlobalHiddenTokens(): string[] {
    return this.getItem<string[]>(HIDDEN_TOKENS_IDENTIFIER) ?? [];
  }

  /**
   * Removes the legacy global token + hidden-token keys after migration.
   */
  static clearLegacyGlobalTokenData(): void {
    localStorage.removeItem(TOKEN_LIST_IDENTIFIER);
    localStorage.removeItem(HIDDEN_TOKENS_IDENTIFIER);
  }

  /**
   * Full-wipe helper: removes every account-scoped token + hidden-token
   * key (plus any legacy global keys). Used by the explicit "clear
   * wallet" flow, NOT by logout (logout intentionally preserves these so
   * re-importing the same account restores its curated token list).
   */
  static clearAllTokenData(): void {
    this.removeKeysEndingWith(`_${TOKEN_LIST_IDENTIFIER}`);
    this.removeKeysEndingWith(`_${HIDDEN_TOKENS_IDENTIFIER}`);
    this.clearLegacyGlobalTokenData();
  }

  /**
   * Full-wipe helper: removes every account-scoped NFT + hidden-NFT key.
   * Used by the explicit "clear wallet" flow.
   */
  static clearAllNftData(): void {
    this.removeKeysEndingWith(`_${NFT_LIST_IDENTIFIER}`);
    this.removeKeysEndingWith(`_${HIDDEN_NFTS_IDENTIFIER}`);
  }

  private static removeKeysEndingWith(suffix: string): void {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith(suffix)) toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  }

  static async getBlockChain() {
    const DEFAULT_BLOCKCHAIN = QRL_PROVIDER.TEST_NET.id;
    const storedBlockchain = this.getItem<string>(BLOCKCHAIN_SELECTION_IDENTIFIER);
    // Guard against stale keys (e.g. "CUSTOM_RPC") that no longer exist in
    // QRL_PROVIDER — silently migrate those users to TEST_NET (default until
    // mainnet launch).
    const isValid =
      storedBlockchain != null &&
      Object.prototype.hasOwnProperty.call(QRL_PROVIDER, storedBlockchain);
    return (isValid ? storedBlockchain : DEFAULT_BLOCKCHAIN) as BlockchainType;
  }

  /**
   * A function for storing the active account in the wallet.
   * Call the getActiveAccount function to retrieve the stored value.
   * Data expires after 6 hours on desktop web (native app bypasses expiration).
   */
  static async setActiveAccount(blockchain: string, activeAccount?: string) {
    const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
    if (activeAccount) {
      this.setItem(blockChainAccountIdentifier, activeAccount);

      // Ensure account is in the account list (default source assumed to be 'seed')
      const accountList = await this.getAccountList(blockchain);
      if (!accountList.some(item => item.address.toLowerCase() === activeAccount.toLowerCase())) {
        await this.setAccountList(blockchain, [...accountList, { address: activeAccount, source: 'seed' }]);
      }
    } else {
      localStorage.removeItem(blockChainAccountIdentifier);
    }
    dispatchStorageEvent(STORAGE_EVENT_ACTIVE_ACCOUNT);
  }

  static async getActiveAccount(blockchain: string) {
    const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
    return this.getItem<string>(blockChainAccountIdentifier) ?? "";
  }

  static async clearActiveAccount(blockchain: string) {
    const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
    localStorage.removeItem(blockChainAccountIdentifier);
    dispatchStorageEvent(STORAGE_EVENT_ACTIVE_ACCOUNT);
  }

  /**
   * Stores a list of accounts along with their sources (seed or extension).
   */
  static async setAccountList(blockchain: string, accountList: AccountListItem[]) {
    const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
    this.setItem(blockChainAccountListIdentifier, accountList);
  }

  /**
   * Retrieves the stored account list.  Returns an empty array if nothing is stored.
   * If the data was saved with the old format (an array of strings) it will be
   * converted on-the-fly to the new format assuming the source is a local seed.
   */
  static async getAccountList(blockchain: string): Promise<AccountListItem[]> {
    const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
    const data = this.getItem<unknown>(blockChainAccountListIdentifier);

    if (!data) {
      return [];
    }

    // New format: already an array of objects with address + source
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      return data as AccountListItem[];
    }

    // Old format: array of address strings, convert to new structure (default source = 'seed')
    if (Array.isArray(data) && (data.length === 0 || typeof data[0] === 'string')) {
      const converted: AccountListItem[] = (data as string[]).map(addr => ({ address: addr, source: 'seed' }));
      // Persist back in new format so we do the conversion only once
      await this.setAccountList(blockchain, converted);
      return converted;
    }

    // Fallback: unknown structure
    return [];
  }

  /**
   * Returns the maximum number of wallets allowed
   */
  static getMaxWallets(): number {
    return MAX_WALLETS;
  }

  /**
   * Checks if the wallet limit has been reached for a blockchain
   * @param blockchain The blockchain identifier
   * @returns True if the wallet limit has been reached
   */
  static async isWalletLimitReached(blockchain: string): Promise<boolean> {
    const accountList = await this.getAccountList(blockchain);
    return accountList.length >= MAX_WALLETS;
  }

  /**
   * Gets the current wallet count for a blockchain
   * @param blockchain The blockchain identifier
   * @returns The number of wallets currently stored
   */
  static async getWalletCount(blockchain: string): Promise<number> {
    const accountList = await this.getAccountList(blockchain);
    return accountList.length;
  }

  /**
   * A function for storing the transaction state values.
   * Only stores non-sensitive data like receiver address and amount.
   * Data expires after 6 hours.
   */
  static async setTransactionValues(
    blockchain: string,
    transactionValues: TransactionValuesType,
  ) {
    const transactionValuesIdentifier = `${blockchain}_${TRANSACTION_VALUES_IDENTIFIER}`;
    const safeValues = {
      receiverAddress: transactionValues.receiverAddress ?? "",
      amount: transactionValues.amount ?? 0,
    };

    this.setItem(transactionValuesIdentifier, safeValues);
  }

  static async getTransactionValues(blockchain: string) {
    const transactionValuesIdentifier = `${blockchain}_${TRANSACTION_VALUES_IDENTIFIER}`;
    return this.getItem<TransactionValuesType>(transactionValuesIdentifier) ?? {};
  }

  static async clearTransactionValues(blockchain: string) {
    const transactionValuesIdentifier = `${blockchain}_${TRANSACTION_VALUES_IDENTIFIER}`;
    localStorage.removeItem(transactionValuesIdentifier);
  }

  static async setWalletSettings(settings: WalletSettings) {
    this.setItem(WALLET_SETTINGS_IDENTIFIER, settings);
    dispatchStorageEvent(STORAGE_EVENT_WALLET_SETTINGS);
  }

  static async getWalletSettings(): Promise<WalletSettings> {
    const stored = this.getItem<Partial<WalletSettings>>(WALLET_SETTINGS_IDENTIFIER) ?? {};
    return {
      autoLockTimeout: stored.autoLockTimeout ?? AUTO_LOCK_TIMEOUT,
      showTokensCard: stored.showTokensCard ?? true,
      showNftsCard: stored.showNftsCard ?? true,
    };
  }

  /**
   * Stores an encrypted seed for an account
   * @param blockchain The blockchain identifier
   * @param address The account address
   * @param encryptedSeed The encrypted seed data from WalletEncryptionUtil.encryptSeedWithPin
   */
  static async storeEncryptedSeed(blockchain: string, address: string, encryptedSeed: string) {
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    const encryptedSeeds = this.getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? [];

    // Update or add the encrypted seed
    const existingIndex = encryptedSeeds.findIndex(item => item.address === address);
    const seedData: EncryptedSeedData = {
      address,
      encryptedSeed,
      lastAccessed: Date.now()
    };

    if (existingIndex >= 0) {
      encryptedSeeds[existingIndex] = seedData;
    } else {
      encryptedSeeds.push(seedData);
    }

    this.setItem(encryptedSeedsKey, encryptedSeeds);
  }

  /**
   * Retrieves an encrypted seed for an account
   * @param blockchain The blockchain identifier
   * @param address The account address
   * @returns The encrypted seed data or null if not found
   */
  static async getEncryptedSeed(blockchain: string, address: string): Promise<string | null> {
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    const encryptedSeeds = this.getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? [];

    const seedData = encryptedSeeds.find(item => item.address === address);
    if (seedData) {
      // Update last accessed time
      await this.storeEncryptedSeed(blockchain, address, seedData.encryptedSeed);
      return seedData.encryptedSeed;
    }

    return null;
  }

  /**
   * Retrieves all encrypted seeds for a blockchain
   * @param blockchain The blockchain identifier
   * @returns Array of all stored encrypted seeds
   */
  static async getAllEncryptedSeeds(blockchain: string): Promise<EncryptedSeedData[]> {
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    return this.getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? [];
  }

  /**
   * Checks if any encrypted seeds exist for a blockchain
   * @param blockchain The blockchain identifier
   * @returns True if at least one encrypted seed exists
   */
  static async hasEncryptedSeeds(blockchain: string): Promise<boolean> {
    const seeds = await this.getAllEncryptedSeeds(blockchain);
    return seeds.length > 0;
  }

  /**
   * Updates all encrypted seeds for a blockchain atomically
   * Used when changing PIN - replaces all encrypted seeds with newly encrypted versions
   * @param blockchain The blockchain identifier
   * @param seeds Array of updated encrypted seed data
   */
  static async updateAllEncryptedSeeds(blockchain: string, seeds: EncryptedSeedData[]): Promise<void> {
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    this.setItem(encryptedSeedsKey, seeds);
  }

  /**
   * Removes an encrypted seed for an account
   * @param blockchain The blockchain identifier
   * @param address The account address
   */
  static async removeEncryptedSeed(blockchain: string, address: string) {
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    let encryptedSeeds = this.getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? [];

    encryptedSeeds = encryptedSeeds.filter(item => item.address !== address);
    this.setItem(encryptedSeedsKey, encryptedSeeds);
  }

  /**
   * Removes all encrypted seeds that have not been accessed within the auto-lock timeout period
   * @param blockchain The blockchain identifier
   */
  static async cleanupExpiredSeeds(blockchain: string) {
    const settings = await this.getWalletSettings();
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    let encryptedSeeds = this.getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? [];

    const now = Date.now();
    encryptedSeeds = encryptedSeeds.filter(
      item => (now - item.lastAccessed) < settings.autoLockTimeout
    );

    this.setItem(encryptedSeedsKey, encryptedSeeds);
  }

  /**
   * Clears ALL encrypted seeds for a blockchain (used by native app wallet removal)
   * @param blockchain The blockchain identifier
   */
  static clearAllEncryptedSeeds(blockchain: string): void {
    const encryptedSeedsKey = `${blockchain}_${ENCRYPTED_SEEDS_IDENTIFIER}`;
    localStorage.removeItem(encryptedSeedsKey);
  }

  /**
   * Clears the account list for a blockchain
   * @param blockchain The blockchain identifier
   */
  static clearAccountList(blockchain: string): void {
    const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
    localStorage.removeItem(blockChainAccountListIdentifier);
  }

  /**
   * Get list of hidden token addresses for an account scope.
   */
  static async getHiddenTokens(blockchain: string, account: string): Promise<string[]> {
    if (!blockchain || !account) return [];
    return this.getItem<string[]>(this.hiddenTokensKey(blockchain, account)) ?? [];
  }

  /**
   * Add a token address to the hidden list
   */
  static async hideToken(blockchain: string, account: string, tokenAddress: string) {
    if (!blockchain || !account) return;
    const hiddenTokens = await this.getHiddenTokens(blockchain, account);
    if (!hiddenTokens.some(addr => addr.toLowerCase() === tokenAddress.toLowerCase())) {
      hiddenTokens.push(tokenAddress.toLowerCase());
      this.setItem(this.hiddenTokensKey(blockchain, account), hiddenTokens);
    }
  }

  /**
   * Remove a token address from the hidden list
   */
  static async unhideToken(blockchain: string, account: string, tokenAddress: string) {
    if (!blockchain || !account) return;
    let hiddenTokens = await this.getHiddenTokens(blockchain, account);
    hiddenTokens = hiddenTokens.filter(addr => addr.toLowerCase() !== tokenAddress.toLowerCase());
    this.setItem(this.hiddenTokensKey(blockchain, account), hiddenTokens);
  }

  static async setBalanceCache(blockchain: string, balances: Record<string, string>) {
    const key = `${blockchain}_${BALANCE_CACHE_IDENTIFIER}`;
    this.setItem(key, balances);
  }

  static async getBalanceCache(blockchain: string): Promise<Record<string, string>> {
    const key = `${blockchain}_${BALANCE_CACHE_IDENTIFIER}`;
    return this.getItem<Record<string, string>>(key) ?? {};
  }

  /**
   * Clear all hidden tokens for an account scope (re-show all).
   */
  static async clearHiddenTokens(blockchain: string, account: string) {
    if (!blockchain || !account) return;
    localStorage.removeItem(this.hiddenTokensKey(blockchain, account));
  }

  /**
   * NFT list — keyed by `${blockchain}_${account}` so collectibles from
   * one wallet/chain never bleed into another. Returns `[]` when either
   * scope component is empty (caller's bootstrap typically races init).
   * Replaces the older global key which leaked across accounts on
   * re-import and across networks on chain switch.
   */
  private static nftListKey(blockchain: string, account: string) {
    return `${blockchain}_${account.toLowerCase()}_${NFT_LIST_IDENTIFIER}`;
  }

  private static hiddenNftsKey(blockchain: string, account: string) {
    return `${blockchain}_${account.toLowerCase()}_${HIDDEN_NFTS_IDENTIFIER}`;
  }

  static async getNftList(blockchain: string, account: string): Promise<NFTInterface[]> {
    if (!blockchain || !account) return [];
    return this.getItem<NFTInterface[]>(this.nftListKey(blockchain, account)) ?? [];
  }

  static async updateNftList(blockchain: string, account: string, list: NFTInterface[]) {
    if (!blockchain || !account) return;
    this.setItem(this.nftListKey(blockchain, account), list);
  }

  static async clearNftList(blockchain: string, account: string) {
    if (!blockchain || !account) return;
    localStorage.removeItem(this.nftListKey(blockchain, account));
  }

  static async getHiddenNfts(blockchain: string, account: string): Promise<string[]> {
    if (!blockchain || !account) return [];
    return this.getItem<string[]>(this.hiddenNftsKey(blockchain, account)) ?? [];
  }

  static async hideNft(blockchain: string, account: string, key: string) {
    if (!blockchain || !account) return;
    const list = await this.getHiddenNfts(blockchain, account);
    if (!list.some(k => k.toLowerCase() === key.toLowerCase())) {
      list.push(key.toLowerCase());
      this.setItem(this.hiddenNftsKey(blockchain, account), list);
    }
  }

  static async unhideNft(blockchain: string, account: string, key: string) {
    if (!blockchain || !account) return;
    let list = await this.getHiddenNfts(blockchain, account);
    list = list.filter(k => k.toLowerCase() !== key.toLowerCase());
    this.setItem(this.hiddenNftsKey(blockchain, account), list);
  }

  static async clearHiddenNfts(blockchain: string, account: string) {
    if (!blockchain || !account) return;
    localStorage.removeItem(this.hiddenNftsKey(blockchain, account));
  }
}

export default StorageUtil;
