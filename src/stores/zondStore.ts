import { ZOND_PROVIDER } from "@/configuration/zondConfig";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import StorageUtil, { AccountListItem, AccountSource } from "@/utilities/storageUtil";
import log from "@/utilities/logUtil"; // Assuming there's a log utility
import Web3, {
  TransactionReceipt,
  Web3ZondInterface,
  utils,
} from "@theqrl/web3";
import { action, computed, makeAutoObservable, observable, runInAction } from "mobx";
import { customERC20FactoryABI } from "@/abi/CustomERC20FactoryABI";
import { fetchTokenInfo, fetchBalance } from "@/utilities/web3utils/customERC20";
import { TokenInterface } from "@/lib/constants";
import { KNOWN_TOKEN_LIST } from "@/lib/constants";
import CustomERC20ABI from "@/abi/CustomERC20ABI";
import { getPendingTxApiUrl } from "@/configuration/zondConfig"; // Import the new helper
import { formatUnits } from "ethers";
import { getOptimalTokenBalance } from "@/functions/getOptimalTokenBalance";

type ActiveAccountType = {
  accountAddress: string;
  lastSeen: number; // Unix timestamp
};

type ZondAccountType = {
  accountAddress: string;
  accountBalance: string;
  source: AccountSource;
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

// Interface for the extension provider (adjust based on actual provider methods)
interface ExtensionProvider {
  request: (args: { method: string; params?: any[] | object }) => Promise<any>;
  // Add other methods if needed, e.g., for event handling
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
  extensionProvider: ExtensionProvider | null = null; // NEW: Store the extension provider

  // NEW: Computed properties
  // 1) active account balance
  get activeAccountBalance(): string {
    if (!this.activeAccount.accountAddress) {
      return "0";
    }
    return (
      this.zondAccounts.accounts.find(
        (account) => account.accountAddress === this.activeAccount.accountAddress,
      )?.accountBalance ?? "0"
    );
  }

  // 2) Source of the currently active account ('seed' by default if not found)
  get activeAccountSource(): AccountSource {
    const currentAddr = this.activeAccount.accountAddress.toLowerCase();
    return (
      this.zondAccounts.accounts.find(
        (account) => account.accountAddress.toLowerCase() === currentAddr,
      )?.source ?? 'seed'
    );
  }

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
      extensionProvider: observable.ref, // Use ref for complex objects like providers
      activeAccountBalance: computed,
      activeAccountSource: computed,
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
      setExtensionProvider: action.bound, // NEW action
      sendTransactionViaExtension: action.bound, // NEW action
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
      const { name, url: baseUrl } = ZOND_PROVIDER[selectedBlockChain];
      let url = baseUrl;

      if (selectedBlockChain === "CUSTOM_RPC") {
        const customRpcUrl = await StorageUtil.getCustomRpcUrl();
        url = `${baseUrl}?customRpcUrl=${customRpcUrl}`
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

      for (const token of KNOWN_TOKEN_LIST) {
        await this.addToken(token);
      }

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

  async setActiveAccount(newActiveAccount?: string, source: AccountSource = 'seed') {
    const currentBlockchain = this.zondConnection.blockchain;
    await StorageUtil.setActiveAccount(
      currentBlockchain,
      newActiveAccount,
    );

    runInAction(() => {
      this.activeAccount = {
        ...this.activeAccount,
        accountAddress: newActiveAccount ?? "",
      };
    });

    let storedAccountList: AccountListItem[] = [];
    try {
      const accountListFromStorage = await StorageUtil.getAccountList(
        currentBlockchain,
      );
      storedAccountList = [...accountListFromStorage];

      if (newActiveAccount) {
        const existingIndex = storedAccountList.findIndex(item => item.address.toLowerCase() === newActiveAccount.toLowerCase());
        if (existingIndex >= 0) {
          // Update source if needed
          storedAccountList[existingIndex] = { address: newActiveAccount, source };
        } else {
          // Add new account
          storedAccountList.push({ address: newActiveAccount, source });
        }
      }
    } finally {
      await StorageUtil.setAccountList(
        currentBlockchain,
        storedAccountList,
      );

      // Explicitly trigger refreshes after setting active account
      await this.fetchAccounts(); // Refresh the full list and balances
      if (newActiveAccount) {
        log(`Fetching balances for newly active account: ${newActiveAccount}`);
        await this.refreshTokenBalances(); // Refresh token balances
      } else {
        log("Active account cleared, skipping token refresh.");
      }
    }
  }

  async fetchZondConnection() {
    this.zondConnection = { ...this.zondConnection, isLoading: true };
    try {
      // Add timeout to prevent hanging on unreachable networks
      const connectionCheckPromise = this.zondInstance?.net.isListening();
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      );

      const isListening = await Promise.race([
        connectionCheckPromise,
        timeoutPromise
      ]).then(result => result ?? false).catch(() => false);

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

    let storedAccountsList: AccountListItem[] = [];
    const accountListFromStorage = await StorageUtil.getAccountList(
      this.zondConnection.blockchain,
    );
    storedAccountsList = accountListFromStorage;
    try {
      const accountsWithBalance: ZondAccountsType["accounts"] =
        await Promise.all(
          storedAccountsList.map(async ({ address, source }) => {
            const accountBalance =
              (await this.zondInstance?.getBalance(address)) ?? BigInt(0);
            const convertedAccountBalance = utils.fromWei(accountBalance, "ether");
            return {
              accountAddress: address,
              accountBalance: convertedAccountBalance,
              source,
            };
          }),
        );
      runInAction(() => {
        this.zondAccounts = {
          ...this.zondAccounts,
          accounts: accountsWithBalance,
        };
      });
    } catch (_error) {
      runInAction(() => {
        this.zondAccounts = {
          ...this.zondAccounts,
          accounts: storedAccountsList.map(({ address, source }) => ({
            accountAddress: address,
            accountBalance: "0",
            source,
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
    value: string,
    mnemonicPhrases: string,
  ) {
    // Reset status before starting a new transaction
    this.resetTransactionStatus();

    try {
      // Fetch the next available nonce, including pending transactions
      const nonce = await this.zondInstance?.getTransactionCount(from, "pending");

      // Fetch current gas price
      const gasPrice = (await this.zondInstance?.getGasPrice()) ?? BigInt(0);
      const gasPriceHex = utils.toHex(gasPrice);

      const transactionObject = {
        from,
        to,
        value: utils.toWei(value, "ether"),
        gas: 21000, // Standard gas limit for native transfer
        type: '0x2',
        maxFeePerGas: gasPriceHex,
        maxPriorityFeePerGas: gasPriceHex,
        nonce: nonce,
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
    try {
      this.setCreatingToken(tokenName, true);
      const selectedBlockChain = await StorageUtil.getBlockChain();
      const { url } = ZOND_PROVIDER[selectedBlockChain as keyof typeof ZOND_PROVIDER];
      const seed = getHexSeedFromMnemonic(mnemonicPhrases);
      const web3 = new Web3(new Web3.providers.HttpProvider(url));
      const acc = web3.zond.accounts.seedToAccount(seed)
      web3.zond.wallet?.add(seed);
      web3.zond.transactionConfirmationBlocks = 1;

      const contractAddress = import.meta.env.VITE_CUSTOMERC20FACTORY_ADDRESS || "";

      // Verify factory contract address is configured
      if (!contractAddress) {
        throw new Error("Factory contract address not configured. Please set VITE_CUSTOMERC20FACTORY_ADDRESS.");
      }

      // Verify factory contract exists before attempting token creation
      const factoryCode = await web3.zond.getCode(contractAddress);
      if (!factoryCode || factoryCode === '0x' || factoryCode === '0x0') {
        throw new Error(`Factory contract not deployed at address: ${contractAddress}`);
      }

      const confirmationHandler = () => {
        this.setCreatingToken("", false);
      }

      const receiptHandler = async (data: TransactionReceipt) => {
        const tokenCreatedEventSignature = web3.utils.keccak256("TokenCreated(address,address)");

        // Try to find the TokenCreated event in receipt logs first
        let tokenCreatedLog = data.logs.find(
          (log) => log.topics?.[0] === tokenCreatedEventSignature &&
                   log.address?.toLowerCase() === contractAddress.toLowerCase()
        );

        // If logs are empty in receipt, fetch them separately using getPastLogs
        if (!tokenCreatedLog && data.blockNumber) {
          try {
            const logs = await web3.zond.getPastLogs({
              fromBlock: data.blockNumber,
              toBlock: data.blockNumber,
              address: contractAddress,
              topics: [tokenCreatedEventSignature]
            });
            const matchingLog = logs.find(
              (log) => typeof log !== 'string' && data.transactionHash != null && log.transactionHash?.toString().toLowerCase() === data.transactionHash.toString().toLowerCase()
            );
            if (matchingLog && typeof matchingLog !== 'string') {
              tokenCreatedLog = matchingLog;
            }
          } catch (err) {
            console.error("Failed to fetch logs via getPastLogs:", err);
          }
        }

        if (!tokenCreatedLog?.topics?.[1]) {
          console.error("Token address not found in transaction receipt or logs");
          this.setCreatingToken("", false);
          return;
        }
        const tokenTopic = tokenCreatedLog.topics[1];
        const erc20TokenAddress = `Z${tokenTopic.toString().slice(-40)}`;
        const tx = data.transactionHash;
        const blockNumber = Number(data.blockNumber);
        const gasUsed = Number(data.gasUsed);
        const effectiveGasPrice = Number(data.effectiveGasPrice);
        const blockHash = data.blockHash;
        const { name, symbol, decimals } = await fetchTokenInfo(erc20TokenAddress, url);
        this.setCreatedToken(name, symbol, parseInt(decimals.toString()), erc20TokenAddress, utils.bytesToHex(tx), blockNumber, gasUsed, effectiveGasPrice, utils.bytesToHex(blockHash));
      }

      const errorHandler = (error: Error) => {
        console.error("Token creation error:", error);
        this.setCreatingToken("", false);
      }

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
    } catch (error) {
      console.error("Failed to create token:", error);
      this.setCreatingToken("", false);
      throw error;
    }
  }

  async refreshTokenBalances() {
    try {
      if (!this.activeAccount.accountAddress) return;

      const selectedBlockChain = await StorageUtil.getBlockChain();
      const updatedTokenList = [...this.tokenList];

      for (let i = 0; i < this.tokenList.length; i++) {
        const token = this.tokenList[i];
        try {
          const balance = await fetchBalance(token.address, this.activeAccount.accountAddress, ZOND_PROVIDER[selectedBlockChain as keyof typeof ZOND_PROVIDER].url);
          const balanceStr = formatUnits(balance, token.decimals);
          updatedTokenList[i] = { ...token, amount: getOptimalTokenBalance(balanceStr, token.symbol) };
        } catch (err) {
          console.error(`Error fetching balance for token ${token.symbol}:`, err);
          updatedTokenList[i] = { ...token, amount: "Error" };
        }
      }

      await this.setTokenList(updatedTokenList);
    } catch (error) {
      console.error("Error refreshing token balances:", error);
    }
  }

  // NEW: Action to set or clear the extension provider
  setExtensionProvider(provider: ExtensionProvider | null) {
    runInAction(() => {
      this.extensionProvider = provider;
      if (provider) {
        log("Extension provider set.");
      } else {
        log("Extension provider cleared.");
        // Optional: Consider if clearing the provider should also clear the active account
        // if the active account *was* from the extension.
        // if (this.activeAccount?.isFromExtension) { // Need a way to track this
        //   this.setActiveAccount(undefined);
        // }
      }
    });
  }

  // --- NEW: Function to poll for transaction receipt ---
  async pollForReceipt(txHash: string) {
    if (!txHash || !this.zondInstance) return;

    const maxAttempts = 60; // Poll for ~5 minutes (60 attempts * 5 seconds)
    const pollInterval = 5000; // 5 seconds
    let attempts = 0;

    log(`Starting receipt polling for ${txHash}`);

    const intervalId = setInterval(async () => {
      // Stop polling if state is no longer pending or hash changed
      if (this.transactionStatus.state !== 'pending' || this.transactionStatus.txHash !== txHash) {
        log(`Stopping receipt polling for ${txHash} (state changed)`);
        clearInterval(intervalId);
        return;
      }

      attempts++;
      log(`Polling for receipt ${txHash}, attempt ${attempts}`);

      try {
        const receipt = await this.zondInstance?.getTransactionReceipt(txHash);

        if (receipt) {
          log(`Receipt found for ${txHash}`);
          clearInterval(intervalId); // Stop polling

          runInAction(() => {
            // Double-check state again before updating
            if (this.transactionStatus.state === 'pending' && this.transactionStatus.txHash === txHash) {
              const txHashString = utils.bytesToHex(receipt.transactionHash);
              this.transactionStatus = {
                state: 'confirmed',
                txHash: txHashString,
                receipt: receipt,
                error: null,
                pendingDetails: null, // Clear pending details
              };
              log(`Transaction confirmed via polling: ${txHashString}`);
              this.fetchAccounts(); // Refresh account balance
            } else {
              log(`Receipt found for ${txHash}, but state changed before update.`);
            }
          });
        } else if (attempts >= maxAttempts) {
          // Max attempts reached, transaction likely failed or stuck
          log(`Max polling attempts reached for ${txHash}. Marking as failed.`);
          clearInterval(intervalId);
          runInAction(() => {
            if (this.transactionStatus.state === 'pending' && this.transactionStatus.txHash === txHash) {
              this.transactionStatus = {
                state: 'failed',
                txHash: txHash,
                receipt: null,
                error: 'Transaction confirmation timed out.',
                pendingDetails: null,
              };
            }
          });
        }
        // If receipt is null and attempts < maxAttempts, continue polling
      } catch (error: any) {
        console.error(`Error polling for receipt ${txHash}:`, error);
        log(`Error polling for receipt ${txHash}: ${error.message || error}`);
        clearInterval(intervalId);
        // Mark as failed on error
        runInAction(() => {
          if (this.transactionStatus.state === 'pending' && this.transactionStatus.txHash === txHash) {
            this.transactionStatus = {
              state: 'failed',
              txHash: txHash,
              receipt: null,
              error: `Error checking transaction status: ${error.message || error}`,
              pendingDetails: null,
            };
          }
        });
      }
    }, pollInterval);
  }
  // --- END NEW Function ---

  // --- NEW: Send Transaction via Extension ---
  async sendTransactionViaExtension(to: string, valueEther: string /* Value in Ether */) {
    if (!this.extensionProvider) {
      console.error("sendTransactionViaExtension called but no provider is set.");
      log("Error: sendTransactionViaExtension called without provider.");
      runInAction(() => {
        this.transactionStatus = { ...this.transactionStatus, state: 'failed', error: 'Extension not connected.' };
      });
      return;
    }
    if (!this.activeAccount.accountAddress) {
      console.error("sendTransactionViaExtension called but no active account.");
      log("Error: sendTransactionViaExtension called without active account.");
      runInAction(() => {
        this.transactionStatus = { ...this.transactionStatus, state: 'failed', error: 'No active account selected.' };
      });
      return;
    }

    try {
      // Reset status before starting
      this.resetTransactionStatus();
      runInAction(() => {
        this.transactionStatus = { ...this.transactionStatus, state: 'pending' };
      });

      // --- Use 18 decimals via "ether" unit --- 
      let valueBaseUnit: string | bigint; // toWei returns string or bigint
      try {
        valueBaseUnit = utils.toWei(valueEther, "ether"); // Use "ether" for 18 decimals
      } catch (calcError) {
        console.error("Error calculating base unit value with toWei:", calcError);
        throw new Error("Could not calculate transaction value.");
      }
      // --- End Wei Calculation ---

      const gasLimit = 53000;
      const defaultMaxPriorityFeePerGasWei = '10000000'; // 0.01 Gwei (Tip)
      const defaultMaxFeePerGasWei = '100000000';         // 0.1 Gwei (Cap)

      // --- Manual Hex Conversion (still needed as utils.toHex was unreliable) --- 
      // Convert potential string/BigInt from toWei to hex safely
      const valueHex = "0x" + BigInt(valueBaseUnit).toString(16);
      const gasHex = "0x" + gasLimit.toString(16);
      const maxPriorityFeeHex = "0x" + parseInt(defaultMaxPriorityFeePerGasWei).toString(16);
      const maxFeeHex = "0x" + parseInt(defaultMaxFeePerGasWei).toString(16);
      // --- End Manual Hex Conversion ---

      const params = [{
        from: this.activeAccount.accountAddress,
        to: to,
        value: valueHex, // Use manually hexed value from toWei("ether")
        gas: gasHex,
        maxPriorityFeePerGas: maxPriorityFeeHex,
        maxFeePerGas: maxFeeHex,
        type: '0x2'
      }];

      log(`Requesting transaction via extension (18 Decimals): ${JSON.stringify(params)}`);
      // Extension provider handles user confirmation popup
      const txHash = await this.extensionProvider.request({
        method: 'zond_sendTransaction',
        params: params
      });

      if (txHash && typeof txHash === 'string') {
        log(`Transaction sent via extension, hash: ${txHash}`);
        runInAction(() => {
          // Still 'pending' until confirmed on-chain, but we have the hash
          this.transactionStatus = { ...this.transactionStatus, state: 'pending', txHash: txHash, error: null };
          // Start polling for receipt / pending details
          this.fetchPendingTxDetails(txHash);
          this.pollForReceipt(txHash);
        });
      } else {
        log(`Extension returned invalid txHash: ${txHash}`);
        throw new Error("Extension did not return a valid transaction hash.");
      }

    } catch (error: any) {
      console.error("Error sending transaction via extension:", error);
      log(`Error sending via extension: ${error.message || error}`);
      runInAction(() => {
        // Check for user rejection code specifically if the provider follows EIP-1193 errors
        const userRejected = error.code === 4001;
        const isCalcError = error.message === "Could not calculate transaction value." || error.message === "Invalid amount input";
        this.transactionStatus = {
          ...this.transactionStatus,
          state: 'failed',
          error: userRejected
            ? 'Transaction rejected in extension.'
            : isCalcError
              ? error.message // Show calculation error
              : (error.message || 'Transaction failed in extension.')
        };
      });
    }
  }
}

export default ZondStore;