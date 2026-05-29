import { QRL_PROVIDER, EXPLORER_BASE, getPendingTxApiUrl } from "@/config";
import { deriveHexSeedAsync } from "@/utils/crypto";
import { StorageUtil, AccountListItem, AccountSource } from "@/utils/storage";
import { log } from "@/utils";
import { getQrlWeb3 } from "@/utils/web3";
import type { TransactionReceipt, Web3QRLInterface } from "@theqrl/web3";
import { action, computed, makeAutoObservable, observable, runInAction } from "mobx";

type ActiveAccountType = {
  accountAddress: string;
  lastSeen: number; // Unix timestamp
};

type QrlAccountType = {
  accountAddress: string;
  accountBalance: string;
  source: AccountSource;
};

type QrlAccountsType = {
  accounts: QrlAccountType[];
  isLoading: boolean;
};

// Type for relevant pending transaction details from Explorer API
type PendingTxInfo = {
  from: string;
  to: string;
  gasPrice: string; // Hex string
  value: string;    // Hex string
  gas: string;      // Gas limit (hex string)
  nonce: string;    // Transaction nonce (hex string)
  hash: string;     // Transaction hash
  lastSeen: number; // Unix timestamp
}

// Transaction status type — exported so token/NFT stores can write into
// the shared `transactionStatus` slot on this store.
export type TransactionStatus = {
  state: 'idle' | 'pending' | 'confirmed' | 'failed';
  txHash: string | null;
  receipt: TransactionReceipt | null;
  error: string | null;
  pendingDetails: PendingTxInfo | null;
}

export type FeeLevel = 'low' | 'medium' | 'high';

const FEE_MULTIPLIERS: Record<FeeLevel, { maxFee: bigint; priorityFee: bigint }> = {
  low:    { maxFee: BigInt(100), priorityFee: BigInt(100) },  // 1x
  medium: { maxFee: BigInt(150), priorityFee: BigInt(125) },  // 1.5x / 1.25x
  high:   { maxFee: BigInt(200), priorityFee: BigInt(150) },  // 2x / 1.5x
};

// Exported so token/NFT stores can share the same fee-multiplier math
// they used to call when this lived inside qrlStore directly.
export function applyFeeLevel(baseGasPrice: bigint, level: FeeLevel) {
  const m = FEE_MULTIPLIERS[level];
  return {
    maxFeePerGas: (baseGasPrice * m.maxFee) / BigInt(100),
    maxPriorityFeePerGas: (baseGasPrice * m.priorityFee) / BigInt(100),
  };
}

// Interface for the extension provider (adjust based on actual provider methods)
interface ExtensionProvider {
  request: (args: { method: string; params?: any[] | object }) => Promise<any>;
  // Add other methods if needed, e.g., for event handling
}

class QrlStore {
  qrlInstance?: Web3QRLInterface;
  qrlConnection = {
    isConnected: false,
    isLoading: false,
    qrlNetworkName: "",
    blockchain: "",
  };
  qrlAccounts: QrlAccountsType = { accounts: [], isLoading: false };
  activeAccount: ActiveAccountType = { accountAddress: "", lastSeen: 0 };
  // Updated initial state
  transactionStatus: TransactionStatus = { state: 'idle', txHash: null, receipt: null, error: null, pendingDetails: null };
  extensionProvider: ExtensionProvider | null = null; // NEW: Store the extension provider
  qrlPrice: number = 0; // USD price from Explorer
  qrlPriceChange24h: number = 0; // 24h price change percentage

  // Cached reference to @theqrl/web3 utils, set during initializeBlockchain.
  // Stored on the instance so we don't re-import on every action call.
  _utils: Awaited<ReturnType<typeof getQrlWeb3>>["utils"] | undefined = undefined;
  _Web3: Awaited<ReturnType<typeof getQrlWeb3>>["default"] | undefined = undefined;

  // Handle for the pollForReceipt setInterval. Stored on the instance so any
  // disposal path (resetTransactionStatus, store re-init) can clear it.
  // Previously this lived in a function-local variable so a navigation or
  // store re-create left the interval ticking, leaking RPC calls and
  // potentially racing a stale receipt into the current transactionStatus.
  // Excluded from mobx via `_receiptPollerIntervalId: false` in
  // makeAutoObservable below — it's a non-observable runtime handle.
  _receiptPollerIntervalId: ReturnType<typeof setInterval> | null = null;

  // Callbacks wired by Store after construction so token/NFT init can run
  // *after* QrlStore has a live qrlInstance and network selection — and
  // without QrlStore taking a direct dependency on the other stores.
  onBlockchainReady?: () => Promise<void>;
  onActiveAccountChanged?: (newActiveAccount?: string) => Promise<void>;

  // NEW: Computed properties
  // 1) active account balance
  get activeAccountBalance(): string {
    if (!this.activeAccount.accountAddress) {
      return "0";
    }
    return (
      this.qrlAccounts.accounts.find(
        (account) => account.accountAddress === this.activeAccount.accountAddress,
      )?.accountBalance ?? "0"
    );
  }

  // 2) Source of the currently active account ('seed' by default if not found)
  get activeAccountSource(): AccountSource {
    const currentAddr = this.activeAccount.accountAddress.toLowerCase();
    return (
      this.qrlAccounts.accounts.find(
        (account) => account.accountAddress.toLowerCase() === currentAddr,
      )?.source ?? 'seed'
    );
  }

  // 3) Active account balance in USD
  get activeAccountBalanceUsd(): number {
    const balance = parseFloat(this.activeAccountBalance) || 0;
    return balance * this.qrlPrice;
  }

  constructor() {
    makeAutoObservable(this, {
      qrlInstance: observable.struct,
      qrlConnection: observable.struct,
      qrlAccounts: observable.struct,
      activeAccount: observable.struct,
      transactionStatus: observable.struct,
      extensionProvider: observable.ref, // Use ref for complex objects like providers
      qrlPrice: observable,
      qrlPriceChange24h: observable,
      // Runtime handles + their cleanup helper — not observable.
      _utils: false,
      _Web3: false,
      _receiptPollerIntervalId: false,
      cancelReceiptPoller: false,
      // Callback hooks injected by Store — not observable.
      onBlockchainReady: false,
      onActiveAccountChanged: false,
      activeAccountBalance: computed,
      activeAccountSource: computed,
      activeAccountBalanceUsd: computed,
      fetchQrlPrice: action.bound,
      selectBlockchain: action.bound,
      setActiveAccount: action.bound,
      fetchQrlConnection: action.bound,
      fetchAccounts: action.bound,
      getAccountBalance: action.bound,
      signAndSendTransaction: action.bound,
      resetTransactionStatus: action.bound,
      fetchPendingTxDetails: action.bound,
      setExtensionProvider: action.bound,
      sendTransactionViaExtension: action.bound,
      estimateNativeTransferFee: action.bound,
    });

    // Log initialization
    log("QrlStore initialized");

    // Initialize blockchain asynchronously to avoid blocking constructor
    setTimeout(() => {
      this.initializeBlockchain();
    }, 0);
  }

  async fetchQrlPrice() {
    try {
      const res = await fetch(`${EXPLORER_BASE}/api/overview`);
      const data = await res.json();
      const price = data?.currentPrice;
      const change = data?.priceChange24h;
      if (typeof price === "number" && price > 0) {
        runInAction(() => {
          this.qrlPrice = price;
          if (typeof change === "number") {
            this.qrlPriceChange24h = change;
          }
        });
      }
    } catch (e) {
      log("Failed to fetch QRL price: " + e);
    }
  }

  // Updated reset action. Method body runs inside an action automatically
  // because makeAutoObservable annotates this as `action.bound` — no
  // explicit runInAction needed for the synchronous state write.
  resetTransactionStatus() {
    // Always cancel any in-flight poller first so it can't race a stale
    // receipt into the freshly-reset transactionStatus.
    this.cancelReceiptPoller();
    this.transactionStatus = { state: 'idle', txHash: null, receipt: null, error: null, pendingDetails: null };
  }

  // Cancels the pollForReceipt setInterval (if any) and clears the handle.
  // Safe to call when no poller is running. Exposed so any external
  // teardown (page unmount, dapp disconnect, store re-init) can stop the
  // up-to-5-minute RPC loop instead of leaking it.
  cancelReceiptPoller() {
    if (this._receiptPollerIntervalId !== null) {
      clearInterval(this._receiptPollerIntervalId);
      this._receiptPollerIntervalId = null;
    }
  }

  async initializeBlockchain() {
    // Re-initializing the blockchain (e.g. network switch) invalidates any
    // in-flight receipt poller bound to the previous provider's RPC — cancel
    // it before bringing up the new connection.
    this.cancelReceiptPoller();
    try {
      const selectedBlockChain = await StorageUtil.getBlockChain();
      const { name, url } = QRL_PROVIDER[selectedBlockChain];

      runInAction(() => {
        this.qrlConnection = {
          ...this.qrlConnection,
          qrlNetworkName: name,
          blockchain: selectedBlockChain,
        };
      });

      if (!this._Web3) {
        const mod = await getQrlWeb3();
        this._Web3 = mod.default;
        this._utils = mod.utils;
      }
      const Web3 = this._Web3;
      const httpProvider = new Web3.providers.HttpProvider(url);
      const { qrl } = new Web3({ provider: httpProvider });


      runInAction(() => {
        this.qrlInstance = qrl;
      });

      await this.fetchQrlConnection();
      await this.fetchAccounts();
      this.fetchQrlPrice(); // Fire-and-forget, non-blocking
      await this.validateActiveAccount();

      // Hand off to TokenStore (and any other domain store wired by Store)
      // for its post-connection bootstrap. Token state used to be loaded
      // inline here; it's now owned by tokenStore.initialize().
      await this.onBlockchainReady?.();

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

  async setActiveAccount(newActiveAccount?: string, source: AccountSource = 'seed') {
    const currentBlockchain = this.qrlConnection.blockchain;
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
      // Token-side bookkeeping (clear+re-seed, discover, refresh balances)
      // is now owned by tokenStore.handleActiveAccountChanged.
      await this.onActiveAccountChanged?.(newActiveAccount);
    }
  }

  async fetchQrlConnection() {
    this.qrlConnection = { ...this.qrlConnection, isLoading: true };
    try {
      // Add timeout to prevent hanging on unreachable networks
      const connectionCheckPromise = this.qrlInstance?.net.isListening();
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      );

      const isListening = await Promise.race([
        connectionCheckPromise,
        timeoutPromise
      ]).then(result => result ?? false).catch(() => false);

      runInAction(() => {
        this.qrlConnection = {
          ...this.qrlConnection,
          isConnected: isListening,
        };
      });
    } catch (error) {
      console.error('Failed to fetch qrl connection:', error);
      runInAction(() => {
        this.qrlConnection = { ...this.qrlConnection, isConnected: false };
      });
    } finally {
      runInAction(() => {
        this.qrlConnection = { ...this.qrlConnection, isLoading: false };
      });
    }
  }

  async fetchAccounts() {
    this.qrlAccounts = { ...this.qrlAccounts, isLoading: true };

    let storedAccountsList: AccountListItem[] = [];
    const accountListFromStorage = await StorageUtil.getAccountList(
      this.qrlConnection.blockchain,
    );
    storedAccountsList = accountListFromStorage;
    try {
      const accountsWithBalance: QrlAccountsType["accounts"] =
        await Promise.all(
          storedAccountsList.map(async ({ address, source }) => {
            const accountBalance =
              (await this.qrlInstance?.getBalance(address)) ?? BigInt(0);
            const convertedAccountBalance = this._utils!.fromPlanck(accountBalance, "quanta");
            return {
              accountAddress: address,
              accountBalance: convertedAccountBalance,
              source,
            };
          }),
        );
      const balanceMap: Record<string, string> = {};
      accountsWithBalance.forEach(a => { balanceMap[a.accountAddress] = a.accountBalance; });
      await StorageUtil.setBalanceCache(this.qrlConnection.blockchain, balanceMap);
      runInAction(() => {
        this.qrlAccounts = {
          ...this.qrlAccounts,
          accounts: accountsWithBalance,
        };
      });
    } catch (_error) {
      const cachedBalances = await StorageUtil.getBalanceCache(this.qrlConnection.blockchain);
      runInAction(() => {
        this.qrlAccounts = {
          ...this.qrlAccounts,
          accounts: storedAccountsList.map(({ address, source }) => ({
            accountAddress: address,
            accountBalance: cachedBalances[address] ?? "0",
            source,
          })),
        };
      });
    } finally {
      runInAction(() => {
        this.qrlAccounts = { ...this.qrlAccounts, isLoading: false };
      });
    }
  }

  async validateActiveAccount() {
    try {
      const storedActiveAccount = await StorageUtil.getActiveAccount(
        this.qrlConnection.blockchain,
      );

      const confirmedExistingActiveAccount =
        this.qrlAccounts.accounts.find(
          (account) => account.accountAddress === storedActiveAccount,
        )?.accountAddress ?? "";

      if (!confirmedExistingActiveAccount) {
        await StorageUtil.clearActiveAccount(this.qrlConnection.blockchain);
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
      this.qrlAccounts.accounts.find(
        (account) => account.accountAddress === accountAddress,
      )?.accountBalance ?? "0"
    );
  }

  // Action to fetch details for a pending transaction from Explorer API with polling
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
        const apiUrl = getPendingTxApiUrl(this.qrlConnection.blockchain);
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
                  from: pendingTx.from || '',
                  to: pendingTx.to || '',
                  gasPrice: pendingTx.gasPrice || '0x0',
                  value: pendingTx.value || '0x0',
                  gas: pendingTx.gas || '0x0',
                  nonce: pendingTx.nonce || '0x0',
                  hash: pendingTx.hash || '',
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

  // Worst-case fee reserve for a native QRL transfer at the given fee level.
  // gasLimit defaults to 21000 (matches signAndSendTransaction); callers using
  // sendTransactionViaExtension must pass 53000 to match that path.
  // Returns the amount in QRL that must stay in the wallet to cover gas.
  async estimateNativeTransferFee(
    feeLevel: FeeLevel = 'medium',
    gasLimit: number = 21000,
  ): Promise<string> {
    const baseGasPrice = await this.qrlInstance?.getGasPrice();
    if (!baseGasPrice) return "0";
    const { maxFeePerGas } = applyFeeLevel(baseGasPrice, feeLevel);
    return this._utils!.fromPlanck(BigInt(gasLimit) * maxFeePerGas, "quanta");
  }

  // Refactored signAndSendTransaction
  async signAndSendTransaction(
    from: string,
    to: string,
    value: string,
    mnemonicPhrases: string,
    feeLevel: FeeLevel = 'medium',
  ) {
    // Reset status before starting a new transaction
    this.resetTransactionStatus();

    try {
      // Fetch the next available nonce, including pending transactions
      const nonce = await this.qrlInstance?.getTransactionCount(from, "pending");

      // Fetch current gas price and apply fee level multiplier
      const baseGasPrice = (await this.qrlInstance?.getGasPrice()) ?? BigInt(1000000000);
      const { maxFeePerGas, maxPriorityFeePerGas } = applyFeeLevel(baseGasPrice, feeLevel);

      const transactionObject = {
        from,
        to,
        value: this._utils!.toPlanck(value, "quanta"),
        gas: 21000, // Standard gas limit for native transfer
        type: '0x2',
        maxFeePerGas: this._utils!.toHex(maxFeePerGas),
        maxPriorityFeePerGas: this._utils!.toHex(maxPriorityFeePerGas),
        nonce: nonce,
      };
      // Run the MLDSA87 derivation in the crypto worker so the 50–300 ms
      // expansion doesn't freeze the main thread mid-Send animation.
      // Subsequent signTransaction call is comparatively cheap.
      const privateKey = await deriveHexSeedAsync(mnemonicPhrases);

      // Sign the transaction first to ensure validity before proceeding
      const signedTransaction =
        await this.qrlInstance?.accounts.signTransaction(
          transactionObject,
          privateKey
        );

      if (!signedTransaction || !signedTransaction.rawTransaction) {
        throw new Error("Transaction could not be signed");
      }

      // Send the signed transaction and handle PromiEvents
      const promiEvent = this.qrlInstance?.sendSignedTransaction(
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
          const txHashString = this._utils!.bytesToHex(receipt.transactionHash);
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
    if (!txHash || !this.qrlInstance) return;

    const maxAttempts = 60; // Poll for ~5 minutes (60 attempts * 5 seconds)
    const pollInterval = 5000; // 5 seconds
    let attempts = 0;

    log(`Starting receipt polling for ${txHash}`);

    // If a previous poll was somehow left running, kill it before starting
    // a fresh one so we never have two intervals racing into transactionStatus.
    this.cancelReceiptPoller();

    this._receiptPollerIntervalId = setInterval(async () => {
      // Stop polling if state is no longer pending or hash changed
      if (this.transactionStatus.state !== 'pending' || this.transactionStatus.txHash !== txHash) {
        log(`Stopping receipt polling for ${txHash} (state changed)`);
        this.cancelReceiptPoller();
        return;
      }

      attempts++;
      log(`Polling for receipt ${txHash}, attempt ${attempts}`);

      try {
        const receipt = await this.qrlInstance?.getTransactionReceipt(txHash);

        if (receipt) {
          log(`Receipt found for ${txHash}`);
          this.cancelReceiptPoller(); // Stop polling

          runInAction(() => {
            // Double-check state again before updating
            if (this.transactionStatus.state === 'pending' && this.transactionStatus.txHash === txHash) {
              const txHashString = this._utils!.bytesToHex(receipt.transactionHash);
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
          this.cancelReceiptPoller();
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
        this.cancelReceiptPoller();
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
  async sendTransactionViaExtension(to: string, valueEther: string, feeLevel: FeeLevel = 'medium') {
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

      // --- Use 18 decimals via "quanta" unit ---
      let valueBaseUnit: string | bigint; // toPlanck returns string or bigint
      try {
        valueBaseUnit = this._utils!.toPlanck(valueEther, "quanta"); // Use "quanta" for 18 decimals
      } catch (calcError) {
        console.error("Error calculating base unit value with toPlanck:", calcError);
        throw new Error("Could not calculate transaction value.");
      }
      // --- End Wei Calculation ---

      const gasLimit = 53000;

      // Fetch current gas price and apply fee level multiplier
      const baseGasPrice = (await this.qrlInstance?.getGasPrice()) ?? BigInt(1000000000);
      const { maxFeePerGas, maxPriorityFeePerGas } = applyFeeLevel(baseGasPrice, feeLevel);

      const valueHex = "0x" + BigInt(valueBaseUnit).toString(16);
      const gasHex = "0x" + gasLimit.toString(16);
      const maxPriorityFeeHex = "0x" + maxPriorityFeePerGas.toString(16);
      const maxFeeHex = "0x" + maxFeePerGas.toString(16);

      const params = [{
        from: this.activeAccount.accountAddress,
        to: to,
        value: valueHex, // Use manually hexed value from toPlanck("quanta")
        gas: gasHex,
        maxPriorityFeePerGas: maxPriorityFeeHex,
        maxFeePerGas: maxFeeHex,
        type: '0x2'
      }];

      log(`Requesting transaction via extension (18 Decimals): ${JSON.stringify(params)}`);
      // Extension provider handles user confirmation popup
      const txHash = await this.extensionProvider.request({
        method: 'qrl_sendTransaction',
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

export default QrlStore;
