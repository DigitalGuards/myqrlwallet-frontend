import { ZOND_PROVIDER } from "../configuration/zondConfig";
import { getHexSeedFromMnemonic } from "../functions/getHexSeedFromMnemonic";
import StorageUtil from "../utilities/storageUtil";
import log from "../utilities/logUtil"; // Assuming there's a log utility
import Web3, {
  TransactionReceipt,
  Web3ZondInterface,
  utils,
} from "@theqrl/web3";
import { action, makeAutoObservable, observable, runInAction } from "mobx";
import { customERC20FactoryABI } from "@/abi/CustomERC20FactoryABI";
import { fetchTokenInfo, fetchBalance } from "@/utilities/web3utils/customERC20";
import { TokenInterface } from "@/lib/constants";
import { KNOWN_TOKEN_LIST } from "@/lib/constants";
import CustomERC20ABI from "@/abi/CustomERC20ABI";
import { getPendingTxApiUrl } from "@/configuration/zondConfig"; // Import the new helper

type ActiveAccountType = {
  accountAddress: string;
  lastSeen: number; // Unix timestamp
};

type ZondAccountType = {
  accountAddress: string;
  accountBalance: string;
};

type ZondAccountsType = {
  accounts: ZondAccountType[];
  isLoading: boolean;
};

type CreatingTokenType = {
  name: string;
  creating: boolean;
}

type CreatedTokenType = {
  name: string;
  symbol: string;
  decimals: number;
  address: string;
  tx: string;
  blockNumber: number;
  gasUsed: number;
  effectiveGasPrice: number;
  blockHash: string;
}

// Type for relevant pending transaction details from ZondScan API
type PendingTxInfo = {
  from: string;    // Add sender address
  to: string;      // Add receiver address
  gasPrice: string; // Keep as hex string initially
  value: string;    // Keep as hex string initially
  lastSeen: number; // Unix timestamp
}

// New type for transaction status
type TransactionStatus = {
  state: 'idle' | 'pending' | 'confirmed' | 'failed';
  txHash: string | null;
  receipt: TransactionReceipt | null;
  error: string | null;
  pendingDetails: PendingTxInfo | null; // Add field for pending details
}

class ZondStore {
  zondInstance?: Web3ZondInterface;
  zondConnection = {
    isConnected: false,
    isLoading: false,
    zondNetworkName: "",
    blockchain: "",
  };
  zondAccounts: ZondAccountsType = { accounts: [], isLoading: false };
  activeAccount: ActiveAccountType = { accountAddress: "", lastSeen: 0 };
  creatingToken: CreatingTokenType = { name: "", creating: false };
  createdToken: CreatedTokenType = { name: "", symbol: "", decimals: 0, address: "", tx: "", blockNumber: 0, gasUsed: 0, effectiveGasPrice: 0, blockHash: "" };
  tokenList: TokenInterface[] = [];
  customRpcUrl: string = "";
  // Updated initial state
  transactionStatus: TransactionStatus = { state: 'idle', txHash: null, receipt: null, error: null, pendingDetails: null };

  constructor() {
    makeAutoObservable(this, {
      zondInstance: observable.struct,
      zondConnection: observable.struct,
      zondAccounts: observable.struct,
      activeAccount: observable.struct,
      creatingToken: observable.struct,
      createdToken: observable.struct,
      tokenList: observable.struct,
      customRpcUrl: observable.struct,
      transactionStatus: observable.struct,
      setCustomRpcUrl: action.bound,
      addToken: action.bound,
      removeToken: action.bound,
      updateToken: action.bound,
      setTokenList: action.bound,
      setCreatedToken: action.bound,
      setCreatingToken: action.bound,
      selectBlockchain: action.bound,
      setActiveAccount: action.bound,
      fetchZondConnection: action.bound,
      fetchAccounts: action.bound,
      getAccountBalance: action.bound,
      signAndSendTransaction: action.bound,
      createToken: action.bound,
      resetTransactionStatus: action.bound,
      sendToken: action.bound,
      refreshTokenBalances: action.bound,
      fetchPendingTxDetails: action.bound,
    });

    // Log initialization
    log("ZondStore initialized");

    // Initialize blockchain asynchronously to avoid blocking constructor
    setTimeout(() => {
      this.initializeBlockchain();
    }, 0);
  }

  // Updated reset action
  resetTransactionStatus() {
    runInAction(() => {
      this.transactionStatus = { state: 'idle', txHash: null, receipt: null, error: null, pendingDetails: null };
    });
  }

  async initializeBlockchain() {
    try {
      const selectedBlockChain = await StorageUtil.getBlockChain();
      let { name, url } = ZOND_PROVIDER[selectedBlockChain];

      if (selectedBlockChain === "CUSTOM_RPC") {
        const customRpcUrl = await StorageUtil.getCustomRpcUrl();
        url = `${url}?customRpcUrl=${customRpcUrl}`
      }

      runInAction(() => {
        this.zondConnection = {
          ...this.zondConnection,
          zondNetworkName: name,
          blockchain: selectedBlockChain,
        };
      });

      const zondHttpProvider = new Web3.providers.HttpProvider(url);
      const { zond } = new Web3({ provider: zondHttpProvider });


      runInAction(() => {
        this.zondInstance = zond;
      });

      this.tokenList = await StorageUtil.getTokenList();

      KNOWN_TOKEN_LIST.forEach(async (token) => {
        await this.addToken(token);
      });

      await this.fetchZondConnection();
      await this.fetchAccounts();
      await this.validateActiveAccount();

      // Log successful initialization
      log("Blockchain initialized successfully");
    } catch (error) {
      console.error('Failed to initialize blockchain:', error);
      log("Error initializing blockchain: " + error);
    }
  }

  async selectBlockchain(selectedBlockchain: string) {
    await StorageUtil.setBlockChain(selectedBlockchain);
    await this.initializeBlockchain();
  }

  async setCreatingToken(name: string, creating: boolean) {
    this.creatingToken = { name, creating };
  }

  async setCreatedToken(name: string, symbol: string, decimals: number, address: string, tx: string, blockNumber: number, gasUsed: number, effectiveGasPrice: number, blockHash: string) {
    await StorageUtil.setCreatedToken(name, symbol, decimals, address, tx, blockNumber, gasUsed, effectiveGasPrice, blockHash);
    this.createdToken = { name, symbol, decimals, address, tx, blockNumber, gasUsed, effectiveGasPrice, blockHash };
  }

  async addToken(token: TokenInterface) {
    if (!this.tokenList.some(t => t.address.toLowerCase() === token.address.toLowerCase())) {
      await StorageUtil.updateTokenList([...this.tokenList, token]);
      this.tokenList = [...this.tokenList, token];
      return token;
    } else {
      return null;
    }
  }

  async removeToken(token: TokenInterface) {
    await StorageUtil.updateTokenList(this.tokenList.filter(t => t.address.toLowerCase() !== token.address.toLowerCase()));
    this.tokenList = this.tokenList.filter(t => t.address !== token.address);
  }

  async updateToken(token: TokenInterface) {
    await StorageUtil.updateTokenList(this.tokenList.map(t => t.address.toLocaleLowerCase() === token.address.toLocaleLowerCase() ? token : t));
    this.tokenList = this.tokenList.map(t => t.address.toLocaleLowerCase() === token.address.toLocaleLowerCase() ? token : t);
  }

  async setTokenList(tokenList: TokenInterface[]) {
    await StorageUtil.updateTokenList(tokenList);
    this.tokenList = tokenList;
  }

  async setCustomRpcUrl(customRpcUrl: string) {
    await StorageUtil.setCustomRpcUrl(customRpcUrl);
    this.customRpcUrl = customRpcUrl;
  }

  async setActiveAccount(activeAccount?: string) {
    await StorageUtil.setActiveAccount(
      this.zondConnection.blockchain,
      activeAccount,
    );
    this.activeAccount = {
      ...this.activeAccount,
      accountAddress: activeAccount ?? "",
    };

    let storedAccountList: string[] = [];
    try {
      const accountListFromStorage = await StorageUtil.getAccountList(
        this.zondConnection.blockchain,
      );
      storedAccountList = [...accountListFromStorage];
      if (activeAccount) {
        storedAccountList.push(activeAccount);
      }
      storedAccountList = [...new Set(storedAccountList)];
    } finally {
      await StorageUtil.setAccountList(
        this.zondConnection.blockchain,
        storedAccountList,
      );
      await this.fetchAccounts();
    }
  }

  async fetchZondConnection() {
    this.zondConnection = { ...this.zondConnection, isLoading: true };
    try {
      const isListening = (await this.zondInstance?.net.isListening()) ?? false;
      runInAction(() => {
        this.zondConnection = {
          ...this.zondConnection,
          isConnected: isListening,
        };
      });
    } catch (error) {
      console.error('Failed to fetch zond connection:', error);
      runInAction(() => {
        this.zondConnection = { ...this.zondConnection, isConnected: false };
      });
    } finally {
      runInAction(() => {
        this.zondConnection = { ...this.zondConnection, isLoading: false };
      });
    }
  }

  async fetchAccounts() {
    this.zondAccounts = { ...this.zondAccounts, isLoading: true };

    let storedAccountsList: string[] = [];
    const accountListFromStorage = await StorageUtil.getAccountList(
      this.zondConnection.blockchain,
    );
    storedAccountsList = accountListFromStorage;
    try {
      const accountsWithBalance: ZondAccountsType["accounts"] =
        await Promise.all(
          storedAccountsList.map(async (account) => {
            const accountBalance =
              (await this.zondInstance?.getBalance(account)) ?? BigInt(0);
            const convertedAccountBalance = utils.fromWei(accountBalance, "ether");
            return {
              accountAddress: account,
              accountBalance: convertedAccountBalance,
            };
          }),
        );
      runInAction(() => {
        this.zondAccounts = {
          ...this.zondAccounts,
          accounts: accountsWithBalance,
        };
      });
    } catch (error) {
      runInAction(() => {
        this.zondAccounts = {
          ...this.zondAccounts,
          accounts: storedAccountsList.map((account) => ({
            accountAddress: account,
            accountBalance: "0",
          })),
        };
      });
    } finally {
      runInAction(() => {
        this.zondAccounts = { ...this.zondAccounts, isLoading: false };
      });
    }
  }

  async validateActiveAccount() {
    try {
      const storedActiveAccount = await StorageUtil.getActiveAccount(
        this.zondConnection.blockchain,
      );

      const confirmedExistingActiveAccount =
        this.zondAccounts.accounts.find(
          (account) => account.accountAddress === storedActiveAccount,
        )?.accountAddress ?? "";

      if (!confirmedExistingActiveAccount) {
        await StorageUtil.clearActiveAccount(this.zondConnection.blockchain);
      }

      this.activeAccount = {
        ...this.activeAccount,
        accountAddress: confirmedExistingActiveAccount,
      };

      // Only log if we actually have an active account
      if (confirmedExistingActiveAccount) {
        log("Active account validated: " + confirmedExistingActiveAccount);
      }
    } catch (error) {
      console.error('Failed to validate active account:', error);
      log("Error validating active account: " + error);
    }
  }

  getAccountBalance(accountAddress: string) {
    return (
      this.zondAccounts.accounts.find(
        (account) => account.accountAddress === accountAddress,
      )?.accountBalance ?? "0"
    );
  }

  // Action to fetch details for a pending transaction from ZondScan API with polling
  async fetchPendingTxDetails(txHash: string) {
    const maxAttempts = 10; // Try up to 10 times
    const pollInterval = 1500; // Wait 1.5 seconds between attempts

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Stop polling if the transaction is no longer pending or the hash changed
        if (this.transactionStatus.state !== 'pending' || this.transactionStatus.txHash !== txHash) {
          log(`Polling stopped for ${txHash}: status changed.`);
          return;
        }

        log(`Fetching pending details for ${txHash}, attempt ${attempt}`);
        const apiUrl = getPendingTxApiUrl(this.zondConnection.blockchain);
        const response = await fetch(apiUrl);

        if (!response.ok) {
          log(`API request failed (attempt ${attempt}): ${response.statusText}`);
          // Don't throw immediately, allow retries
          if (attempt === maxAttempts) {
            throw new Error(`Failed to fetch pending transactions after ${maxAttempts} attempts: ${response.statusText}`);
          }
          await new Promise(resolve => setTimeout(resolve, pollInterval)); // Wait before retrying
          continue; // Go to next attempt
        }

        const data = await response.json();

        if (!data || !Array.isArray(data.transactions)) {
          log(`Invalid API response structure (attempt ${attempt})`);
          if (attempt === maxAttempts) {
             throw new Error("Invalid API response structure after multiple attempts.");
          }
           await new Promise(resolve => setTimeout(resolve, pollInterval));
           continue;
        }

        const pendingTx = data.transactions.find(
          (tx: any) => tx.hash && tx.hash.toLowerCase() === txHash.toLowerCase()
        );

        if (pendingTx) {
          // Found the transaction!
          runInAction(() => {
             // Check status again *before* updating, in case it changed while fetching
             if (this.transactionStatus.state === 'pending' && this.transactionStatus.txHash === txHash) {
                 this.transactionStatus = {
                     ...this.transactionStatus,
                     pendingDetails: {
                         from: pendingTx.from || '', // Add from address
                         to: pendingTx.to || '',     // Add to address
                         gasPrice: pendingTx.gasPrice || '0x0',
                         value: pendingTx.value || '0x0',
                         lastSeen: pendingTx.lastSeen || Date.now() / 1000,
                     }
                 };
                 log(`Fetched pending details for tx: ${txHash} on attempt ${attempt}`);
             } else {
                 log(`Pending details fetched for ${txHash}, but status already changed.`);
             }
          });
          return; // Exit the function successfully
        }

        // Transaction not found in this attempt
        log(`Pending transaction ${txHash} not found in API response (attempt ${attempt})`);
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval)); // Wait before next attempt
        } else {
          log(`Pending transaction ${txHash} not found after ${maxAttempts} attempts.`);
          // We didn't find it, but don't throw an error, just leave pendingDetails as null
        }
      }
  
    } catch (error) {
      console.error("Error fetching pending transaction details:", error);
      log(`Error fetching pending tx details for ${txHash}: ${error}`);
      // Leave pendingDetails as null on error
    }
  }

  // Refactored signAndSendTransaction
  async signAndSendTransaction(
    from: string,
    to: string,
    value: number,
    mnemonicPhrases: string,
  ) {
    // Reset status before starting a new transaction
    this.resetTransactionStatus();

    try {
      const transactionObject = {
        from,
        to,
        value: utils.toWei(value, "ether"),
        maxFeePerGas: 21000,
        maxPriorityFeePerGas: 21000,
      };
      const privateKey = getHexSeedFromMnemonic(mnemonicPhrases);

      // Sign the transaction first to ensure validity before proceeding
      const signedTransaction =
        await this.zondInstance?.accounts.signTransaction(
          transactionObject,
          privateKey
        );

      if (!signedTransaction || !signedTransaction.rawTransaction) {
        throw new Error("Transaction could not be signed");
      }

      // Send the signed transaction and handle PromiEvents
      const promiEvent = this.zondInstance?.sendSignedTransaction(
        signedTransaction.rawTransaction
      );

      promiEvent?.on('transactionHash', (hash: string) => {
        runInAction(() => {
          this.transactionStatus = {
            state: 'pending',
            txHash: hash,
            receipt: null,
            error: null,
            pendingDetails: null,
          };
          log(`Transaction pending with hash: ${hash}`);
          // Attempt to fetch pending details immediately after getting the hash
          this.fetchPendingTxDetails(hash);
        });
      }).on('receipt', (receipt: TransactionReceipt) => {
        runInAction(() => {
          const txHashString = utils.bytesToHex(receipt.transactionHash);
          this.transactionStatus = {
            state: 'confirmed',
            txHash: txHashString,
            receipt: receipt,
            error: null,
            pendingDetails: null,
          };
          log(`Transaction confirmed: ${txHashString}`);
          // Fetch accounts again to update balance after confirmation
          this.fetchAccounts();
        });
      }).on('error', (error: Error) => {
        runInAction(() => {
          const txHash = this.transactionStatus.txHash;
          this.transactionStatus = {
            state: 'failed',
            txHash: txHash,
            receipt: null,
            error: error.message || "Transaction failed",
            pendingDetails: null,
          };
          log(`Transaction failed for hash ${txHash}: ${error.message}`);
        });
      });

      // Optional: Return the PromiEvent if the caller needs more control,
      // but for this pattern, we primarily manage state within the store.
      // return promiEvent;

    } catch (error: any) {
      // Catch signing errors or other issues before sending
      runInAction(() => {
        this.transactionStatus = {
          state: 'failed',
          txHash: null,
          receipt: null,
          error: `Transaction preparation failed: ${error.message || error}`,
          pendingDetails: null,
        };
        log(`Transaction preparation failed: ${error}`);
      });
    }
  }

  async sendToken(token: TokenInterface, amount: string, mnemonicPhrases: string, toAddress: string) {
    const confirmationHandler = (data: any) => {
      console.log(data);
    }

    const receiptHandler = async (data: any) => {
      console.log(data);
      // Refresh token balances after successful transaction
      await this.refreshTokenBalances();
    }

    const errorHandler = (data: any) => {
      console.error(data);
    }
    const selectedBlockChain = await StorageUtil.getBlockChain();
    const { url } = ZOND_PROVIDER[selectedBlockChain as keyof typeof ZOND_PROVIDER];
    const web3 = new Web3(new Web3.providers.HttpProvider(url));
    const seed = getHexSeedFromMnemonic(mnemonicPhrases);
    const acc = web3.zond.accounts.seedToAccount(seed)
    web3.zond.wallet?.add(seed);
    web3.zond.transactionConfirmationBlocks = 1;
    const contract = new web3.zond.Contract(CustomERC20ABI, token.address);
    const tx = contract.methods.transfer(toAddress, amount).encodeABI();
    const estimateGas = await contract.methods.transfer(toAddress, amount).estimateGas({ "from": acc.address })
    const txObj = { type: '0x2', gas: estimateGas, from: acc.address, data: tx, to: token.address }
    await web3.zond.sendTransaction(txObj, undefined, {
      checkRevertBeforeSending: true
    })
      .on('confirmation', confirmationHandler)
      .on('receipt', receiptHandler)
      .on('error', errorHandler)
    return true;
  }

  async createToken(
    tokenName: string,
    tokenSymbol: string,
    initialSupply: string,
    decimals: number,
    maxSupply: string,
    receipt: string,
    owner: string,
    maxWalletAmount: string,
    maxTxLimit: string,
    mnemonicPhrases: string
  ) {
    this.setCreatingToken(tokenName, true);
    const selectedBlockChain = await StorageUtil.getBlockChain();
    const { url } = ZOND_PROVIDER[selectedBlockChain as keyof typeof ZOND_PROVIDER];
    const seed = getHexSeedFromMnemonic(mnemonicPhrases);
    const web3 = new Web3(new Web3.providers.HttpProvider(url));
    const acc = web3.zond.accounts.seedToAccount(seed)
    web3.zond.wallet?.add(seed);
    web3.zond.transactionConfirmationBlocks = 1;

    const confirmationHandler = (data: any) => {
      this.setCreatingToken("", false);
      console.log(data);
    }

    const receiptHandler = async (data: any) => {
      console.log(data);
      const erc20TokenAddress = `Z${data.logs[3].topics[1].slice(-40)}`;
      const tx = data.transactionHash;
      const blockNumber = Number(data.blockNumber);
      const gasUsed = Number(data.gasUsed);
      const effectiveGasPrice = Number(data.effectiveGasPrice);
      const blockHash = data.blockHash;
      const { name, symbol, decimals } = await fetchTokenInfo(erc20TokenAddress, url);
      this.setCreatedToken(name, symbol, parseInt(decimals.toString()), erc20TokenAddress, tx, blockNumber, gasUsed, effectiveGasPrice, blockHash);
    }

    const errorHandler = (data: any) => {
      console.error(data);
    }

    const contractAddress = import.meta.env.VITE_CUSTOMERC20FACTORY_ADDRESS || "";

    const customERC20Factorycontract = new web3.zond.Contract(customERC20FactoryABI, contractAddress);

    const contractCreateToken = customERC20Factorycontract.methods.createToken(
      tokenName,
      tokenSymbol,
      initialSupply,
      decimals,
      maxSupply,
      receipt,
      owner,
      maxWalletAmount,
      maxTxLimit
    );

    const estimateGas = await contractCreateToken.estimateGas({ "from": acc.address })

    const txObj = { type: '0x2', gas: estimateGas, from: acc.address, data: contractCreateToken.encodeABI(), to: contractAddress }

    await web3.zond.sendTransaction(txObj, undefined, {
      checkRevertBeforeSending: true
    })
      .on('confirmation', confirmationHandler)
      .on('receipt', receiptHandler)
      .on('error', errorHandler)
  }

  async refreshTokenBalances() {
    try {
      if (!this.activeAccount.accountAddress) return;
      
      const selectedBlockChain = await StorageUtil.getBlockChain();
      const updatedTokenList = [...this.tokenList];
      
      for (let i = 0; i < this.tokenList.length; i++) {
        const token = this.tokenList[i];
        const balance = await fetchBalance(token.address, this.activeAccount.accountAddress, ZOND_PROVIDER[selectedBlockChain as keyof typeof ZOND_PROVIDER].url);
        const formattedBalance = utils.fromWei(balance, "ether");
        updatedTokenList[i] = { ...token, amount: formattedBalance };
      }
      
      await this.setTokenList(updatedTokenList);
    } catch (error) {
      console.error("Error refreshing token balances:", error);
    }
  }
}

export default ZondStore;