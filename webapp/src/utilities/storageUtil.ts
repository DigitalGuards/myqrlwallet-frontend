import { ZOND_PROVIDER } from "../configuration/zondConfig";

const ACTIVE_PAGE_IDENTIFIER = "ACTIVE_PAGE";
const BLOCKCHAIN_SELECTION_IDENTIFIER = "BLOCKCHAIN_SELECTION";
const ACTIVE_ACCOUNT_IDENTIFIER = "ACTIVE_ACCOUNT";
const ACCOUNT_LIST_IDENTIFIER = "ACCOUNT_LIST";
const TRANSACTION_VALUES_IDENTIFIER = "TRANSACTION_VALUES";

type TransactionValuesType = {
  receiverAddress?: string;
  amount?: number;
};

type BlockchainType = keyof typeof ZOND_PROVIDER;

/**
 * A utility for storing and retrieving states of different components using localStorage.
 */
class StorageUtil {
  /**
   * A function for storing the active page route.
   * Call the getActivePage function to retrieve the stored value.
   */
  static async setActivePage(activePage: string) {
    if (activePage) {
      localStorage.setItem(ACTIVE_PAGE_IDENTIFIER, activePage);
    } else {
      localStorage.removeItem(ACTIVE_PAGE_IDENTIFIER);
    }
  }

  static async getActivePage() {
    return localStorage.getItem(ACTIVE_PAGE_IDENTIFIER) ?? "";
  }

  /**
   * A function for storing the blockchain selection.
   * Call the getBlockChain function to retrieve the stored value.
   */
  static async setBlockChain(selectedBlockchain: string) {
    localStorage.setItem(BLOCKCHAIN_SELECTION_IDENTIFIER, selectedBlockchain);
  }

  static async getBlockChain() {
    const DEFAULT_BLOCKCHAIN = ZOND_PROVIDER.DEV.id;
    const storedBlockchain = localStorage.getItem(BLOCKCHAIN_SELECTION_IDENTIFIER);
    return (storedBlockchain ?? DEFAULT_BLOCKCHAIN) as BlockchainType;
  }

  /**
   * A function for storing the active account in the wallet.
   * Call the getActiveAccount function to retrieve the stored value.
   */
  static async setActiveAccount(blockchain: string, activeAccount?: string) {
    const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
    if (activeAccount) {
      localStorage.setItem(blockChainAccountIdentifier, activeAccount);
      
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
    return localStorage.getItem(blockChainAccountIdentifier) ?? "";
  }

  static async clearActiveAccount(blockchain: string) {
    const blockChainAccountIdentifier = `${blockchain}_${ACTIVE_ACCOUNT_IDENTIFIER}`;
    localStorage.removeItem(blockChainAccountIdentifier);
  }

  /**
   * A function for storing the accounts created and imported within the zond wallet.
   * Call the getAccountList function to retrieve the stored value.
   */
  static async setAccountList(blockchain: string, accountList: string[]) {
    const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
    localStorage.setItem(blockChainAccountListIdentifier, JSON.stringify(accountList));
  }

  static async getAccountList(blockchain: string) {
    const blockChainAccountListIdentifier = `${blockchain}_${ACCOUNT_LIST_IDENTIFIER}`;
    const storedAccountList = localStorage.getItem(blockChainAccountListIdentifier);
    try {
      const parsedList = storedAccountList ? JSON.parse(storedAccountList) : [];
      return Array.isArray(parsedList) ? parsedList : [];
    } catch {
      return [];
    }
  }

  /**
   * A function for storing the transaction state values.
   * Only stores non-sensitive data like receiver address and amount.
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
    
    localStorage.setItem(
      transactionValuesIdentifier,
      JSON.stringify(safeValues),
    );
  }

  static async getTransactionValues(blockchain: string) {
    const transactionValuesIdentifier = `${blockchain}_${TRANSACTION_VALUES_IDENTIFIER}`;
    const storedValues = localStorage.getItem(transactionValuesIdentifier);
    try {
      return storedValues ? JSON.parse(storedValues) : {};
    } catch {
      return {};
    }
  }

  static async clearTransactionValues(blockchain: string) {
    const transactionValuesIdentifier = `${blockchain}_${TRANSACTION_VALUES_IDENTIFIER}`;
    localStorage.removeItem(transactionValuesIdentifier);
  }
}

export default StorageUtil;
