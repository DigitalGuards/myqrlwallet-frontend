import { ZOND_PROVIDER } from "../configuration/zondConfig";

const ACTIVE_PAGE_IDENTIFIER = "ACTIVE_PAGE";
const BLOCKCHAIN_SELECTION_IDENTIFIER = "BLOCKCHAIN_SELECTION";
const ACTIVE_ACCOUNT_IDENTIFIER = "ACTIVE_ACCOUNT";
const ACCOUNT_LIST_IDENTIFIER = "ACCOUNT_LIST";
const TRANSACTION_VALUES_IDENTIFIER = "TRANSACTION_VALUES";
const STORAGE_VERSION = 'v1';
const MAX_STORAGE_AGE = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

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

  static async getBlockChain() {
    const DEFAULT_BLOCKCHAIN = ZOND_PROVIDER.DEV.id;
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
      
      // Ensure account is in the account list
      const accountList = await this.getAccountList(blockchain);
      if (!accountList.includes(activeAccount)) {
        await this.setAccountList(blockchain, [...accountList, activeAccount]);
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
   * A function for storing the accounts created and imported within the zond wallet.
   * Call the getAccountList function to retrieve the stored value.
   * Data expires after 6 hours.
   */
  static async setAccountList(blockchain: string, accountList: string[]) {
    const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
    this.setItem(blockChainAccountListIdentifier, accountList);
  }

  static async getAccountList(blockchain: string) {
    const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
    return this.getItem<string[]>(blockChainAccountListIdentifier) ?? [];
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
}

export default StorageUtil;
