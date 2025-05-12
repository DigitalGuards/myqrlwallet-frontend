import { ZOND_PROVIDER } from "../configuration/zondConfig";
import { TokenInterface } from "@/lib/constants";

const ACTIVE_PAGE_IDENTIFIER = "ACTIVE_PAGE";
const BLOCKCHAIN_SELECTION_IDENTIFIER = "BLOCKCHAIN_SELECTION";
const CUSTOM_RPC_URL_IDENTIFIER = "CUSTOM_RPC_URL";
const BLOCKCHAIN_CREATED_TOKEN = "CREATED_TOKEN";
const ACTIVE_ACCOUNT_IDENTIFIER = "ACTIVE_ACCOUNT";
const ACCOUNT_LIST_IDENTIFIER = "ACCOUNT_LIST";
const TRANSACTION_VALUES_IDENTIFIER = "TRANSACTION_VALUES";
const TOKEN_LIST_IDENTIFIER = "TOKEN_LIST";
const STORAGE_VERSION = 'v1';
const MAX_STORAGE_AGE = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const WALLET_SETTINGS_IDENTIFIER = "WALLET_SETTINGS";
const ENCRYPTED_SEEDS_IDENTIFIER = "ENCRYPTED_SEEDS";
const AUTO_LOCK_TIMEOUT = 15 * 60 * 1000; // 15 minutes default auto-lock timeout

type TransactionValuesType = {
  receiverAddress?: string;
  amount?: number;
};

type BlockchainType = keyof typeof ZOND_PROVIDER;

interface StorageItem<T> {
  value: T;
  timestamp: number;
  version: string;
}

interface WalletSettings {
  autoLockTimeout: number;
  showTestNetworks: boolean;
  hideSmallBalances: boolean;
  hideUnknownTokens: boolean;
}

interface EncryptedSeedData {
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

  static async setCustomRpcUrl(customRpcUrl: string) {
    this.setItem(CUSTOM_RPC_URL_IDENTIFIER, customRpcUrl);
  }

  static async getCustomRpcUrl() {
    return this.getItem<string>(CUSTOM_RPC_URL_IDENTIFIER) ?? "";
  }

  static async setCreatedToken(name: string, symbol: string, decimals: number, address: string, tx: string, blockNumber: number, gasUsed: number, effectiveGasPrice: number, blockHash: string) {
    this.setItem(BLOCKCHAIN_CREATED_TOKEN, { name, symbol, decimals, address, tx, blockNumber, gasUsed, effectiveGasPrice, blockHash });
  }

  static async updateTokenList(tokenList: TokenInterface[]) {
    console.log(tokenList)
    this.setItem(TOKEN_LIST_IDENTIFIER, tokenList);
  }

  static async getTokenList() {
    return this.getItem<TokenInterface[]>(TOKEN_LIST_IDENTIFIER) ?? [];
  }

  static async getBlockChain() {
    const DEFAULT_BLOCKCHAIN = ZOND_PROVIDER.TEST_NET.id;
    const storedBlockchain = this.getItem<string>(BLOCKCHAIN_SELECTION_IDENTIFIER);
    return (storedBlockchain ?? DEFAULT_BLOCKCHAIN) as BlockchainType;
  }

  /**
   * A function for storing the active account in the wallet.
   * Call the getActiveAccount function to retrieve the stored value.
   * Data expires after 6 hours.
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
  }

  static async getActiveAccount(blockchain: string) {
    const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
    return this.getItem<string>(blockChainAccountIdentifier) ?? "";
  }

  static async clearActiveAccount(blockchain: string) {
    const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
    localStorage.removeItem(blockChainAccountIdentifier);
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
    const data = this.getItem<any>(blockChainAccountListIdentifier);

    if (!data) {
      return [];
    }

    // New format: already an array of objects with address + source
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      return data as AccountListItem[];
    }

    // Old format: array of address strings – convert to new structure (default source = 'seed')
    if (Array.isArray(data) && (data.length === 0 || typeof data[0] === 'string')) {
      const converted: AccountListItem[] = (data as string[]).map(addr => ({ address: addr, source: 'seed' }));
      // Persist back in new format so we do the conversion only once
      await this.setAccountList(blockchain, converted);
      return converted;
    }

    // Fallback – unknown structure
    return [];
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
  }

  static async getWalletSettings(): Promise<WalletSettings> {
    return this.getItem<WalletSettings>(WALLET_SETTINGS_IDENTIFIER) ?? {
      autoLockTimeout: AUTO_LOCK_TIMEOUT,
      showTestNetworks: false,
      hideSmallBalances: false,
      hideUnknownTokens: true,
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
    let encryptedSeeds = this.getItem<EncryptedSeedData[]>(encryptedSeedsKey) ?? [];
    
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
}

export default StorageUtil;
