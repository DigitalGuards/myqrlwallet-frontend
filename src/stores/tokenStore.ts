import { QRL_PROVIDER } from "@/config";
import { deriveHexSeedAsync } from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";
import { log } from "@/utils";
import Web3, { TransactionReceipt, utils } from "@theqrl/web3";
import { action, computed, makeAutoObservable, observable, runInAction } from "mobx";
import { customERC20FactoryABI } from "@/abi/CustomERC20FactoryABI";
import { fetchTokenInfo, fetchBalance, discoverTokens, mergeTokenLists } from "@/utils/web3";
import { TokenInterface, KNOWN_TOKEN_LIST } from "@/constants";
import { customERC20ABI as CustomERC20ABI } from "@/abi/CustomERC20ABI";
import { formatUnits } from "ethers";
import { getOptimalTokenBalance } from "@/utils/formatting";
import type QrlStore from "./qrlStore";
import type { FeeLevel } from "./qrlStore";
import { applyFeeLevel } from "./qrlStore";

type CreatingTokenType = {
  name: string;
  creating: boolean;
  error?: string;
};

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
};

class TokenStore {
  creatingToken: CreatingTokenType = { name: "", creating: false };
  createdToken: CreatedTokenType = {
    name: "",
    symbol: "",
    decimals: 0,
    address: "",
    tx: "",
    blockNumber: 0,
    gasUsed: 0,
    effectiveGasPrice: 0,
    blockHash: "",
  };
  tokenList: TokenInterface[] = [];
  hiddenTokens: string[] = [];

  constructor(private qrlStore: QrlStore) {
    makeAutoObservable(this, {
      creatingToken: observable.struct,
      createdToken: observable.struct,
      tokenList: observable.struct,
      hiddenTokens: observable,
      visibleTokenList: computed,
      setCreatingToken: action.bound,
      setCreatedToken: action.bound,
      addToken: action.bound,
      removeToken: action.bound,
      updateToken: action.bound,
      setTokenList: action.bound,
      sendToken: action.bound,
      createToken: action.bound,
      refreshTokenBalances: action.bound,
      discoverAndAddTokens: action.bound,
      loadHiddenTokens: action.bound,
      hideToken: action.bound,
      unhideToken: action.bound,
      initialize: action.bound,
      handleActiveAccountChanged: action.bound,
    });

    log("TokenStore initialized");
  }

  get visibleTokenList(): TokenInterface[] {
    return this.tokenList.filter(
      (token) =>
        !this.hiddenTokens.some(
          (hidden) => hidden.toLowerCase() === token.address.toLowerCase(),
        ),
    );
  }

  // Called by Store after QrlStore.initializeBlockchain finishes (via the
  // qrlStore.onBlockchainReady hook). Restores the persisted token list and
  // hidden-token list, then seeds known tokens.
  async initialize() {
    const persistedList = await StorageUtil.getTokenList();
    runInAction(() => {
      this.tokenList = persistedList;
    });
    await this.loadHiddenTokens();

    for (const token of KNOWN_TOKEN_LIST) {
      await this.addToken(token);
    }
  }

  // Called by Store after QrlStore.setActiveAccount finishes (via the
  // qrlStore.onActiveAccountChanged hook). Mirrors the previous in-place
  // logic that lived inside setActiveAccount.
  async handleActiveAccountChanged(newActiveAccount?: string) {
    if (!newActiveAccount) {
      log("Active account cleared, skipping token refresh.");
      return;
    }

    log(`Fetching balances for newly active account: ${newActiveAccount}`);
    // Clear token list before discovering tokens for the new account so
    // tokens from inactive accounts don't show with 0 balance.
    await StorageUtil.clearTokenList();
    runInAction(() => {
      this.tokenList = [];
    });

    for (const token of KNOWN_TOKEN_LIST) {
      await this.addToken(token);
    }

    this.discoverAndAddTokens(newActiveAccount)
      .then(() => {
        void this.refreshTokenBalances();
      })
      .catch((error) => {
        log(`Unexpected error during token discovery: ${error}`);
      });
  }

  async setCreatingToken(name: string, creating: boolean, error?: string) {
    this.creatingToken = { name, creating, error };
  }

  async setCreatedToken(
    name: string,
    symbol: string,
    decimals: number,
    address: string,
    tx: string,
    blockNumber: number,
    gasUsed: number,
    effectiveGasPrice: number,
    blockHash: string,
  ) {
    await StorageUtil.setCreatedToken(
      name,
      symbol,
      decimals,
      address,
      tx,
      blockNumber,
      gasUsed,
      effectiveGasPrice,
      blockHash,
    );
    this.createdToken = {
      name,
      symbol,
      decimals,
      address,
      tx,
      blockNumber,
      gasUsed,
      effectiveGasPrice,
      blockHash,
    };
  }

  async addToken(token: TokenInterface) {
    const existingToken = this.tokenList.find(
      (t) => t.address.toLowerCase() === token.address.toLowerCase(),
    );

    if (!existingToken) {
      await StorageUtil.updateTokenList([...this.tokenList, token]);
      this.tokenList = [...this.tokenList, token];
      return token;
    }

    const isHidden = this.hiddenTokens.some(
      (addr) => addr.toLowerCase() === token.address.toLowerCase(),
    );
    if (isHidden) {
      await this.unhideToken(token.address);
      return existingToken;
    }

    return null;
  }

  async removeToken(token: TokenInterface) {
    await StorageUtil.updateTokenList(
      this.tokenList.filter(
        (t) => t.address.toLowerCase() !== token.address.toLowerCase(),
      ),
    );
    this.tokenList = this.tokenList.filter(
      (t) => t.address !== token.address,
    );
  }

  async updateToken(token: TokenInterface) {
    await StorageUtil.updateTokenList(
      this.tokenList.map((t) =>
        t.address.toLocaleLowerCase() === token.address.toLocaleLowerCase()
          ? token
          : t,
      ),
    );
    this.tokenList = this.tokenList.map((t) =>
      t.address.toLocaleLowerCase() === token.address.toLocaleLowerCase()
        ? token
        : t,
    );
  }

  async setTokenList(tokenList: TokenInterface[]) {
    await StorageUtil.updateTokenList(tokenList);
    this.tokenList = tokenList;
  }

  async sendToken(
    token: TokenInterface,
    amount: string,
    mnemonicPhrases: string,
    toAddress: string,
    feeLevel: FeeLevel = "medium",
  ) {
    this.qrlStore.resetTransactionStatus();
    try {
      const selectedBlockChain = await StorageUtil.getBlockChain();
      const { url } = QRL_PROVIDER[selectedBlockChain as keyof typeof QRL_PROVIDER];
      const web3 = new Web3(new Web3.providers.HttpProvider(url));
      const seed = await deriveHexSeedAsync(mnemonicPhrases);
      const acc = web3.qrl.accounts.seedToAccount(seed);
      web3.qrl.wallet?.add(seed);
      web3.qrl.transactionConfirmationBlocks = 1;
      const baseGasPrice = (await web3.qrl.getGasPrice()) ?? BigInt(1000000000);
      const { maxFeePerGas, maxPriorityFeePerGas } = applyFeeLevel(
        baseGasPrice,
        feeLevel,
      );
      const contract = new web3.qrl.Contract(CustomERC20ABI, token.address);
      const tx = contract.methods.transfer(toAddress, amount).encodeABI();
      const estimateGas = await contract.methods
        .transfer(toAddress, amount)
        .estimateGas({ from: acc.address });
      const txObj = {
        type: "0x2",
        gas: estimateGas,
        from: acc.address,
        data: tx,
        to: token.address,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };

      const promiEvent = web3.qrl.sendTransaction(txObj, undefined, {
        checkRevertBeforeSending: true,
      });

      promiEvent
        .on("transactionHash", (hash: string | Uint8Array) => {
          runInAction(() => {
            const txHash =
              typeof hash === "string" ? hash : utils.bytesToHex(hash);
            this.qrlStore.transactionStatus = {
              state: "pending",
              txHash: txHash,
              receipt: null,
              error: null,
              pendingDetails: null,
            };
            log(`Token transfer pending with hash: ${txHash}`);
            this.qrlStore.fetchPendingTxDetails(txHash);
          });
        })
        .on("receipt", (receipt: TransactionReceipt) => {
          runInAction(() => {
            const txHashString = utils.bytesToHex(receipt.transactionHash);
            this.qrlStore.transactionStatus = {
              state: "confirmed",
              txHash: txHashString,
              receipt: receipt,
              error: null,
              pendingDetails: null,
            };
            log(`Token transfer confirmed: ${txHashString}`);
            this.refreshTokenBalances();
            this.qrlStore.fetchAccounts();
          });
        })
        .on("error", (error: Error) => {
          runInAction(() => {
            const txHash = this.qrlStore.transactionStatus.txHash;
            this.qrlStore.transactionStatus = {
              state: "failed",
              txHash: txHash,
              receipt: null,
              error: error.message || "Token transfer failed",
              pendingDetails: null,
            };
            log(`Token transfer failed: ${error.message}`);
          });
        });

      return true;
    } catch (error: any) {
      runInAction(() => {
        this.qrlStore.transactionStatus = {
          state: "failed",
          txHash: null,
          receipt: null,
          error: `Token transfer failed: ${error.message || error}`,
          pendingDetails: null,
        };
        log(`Token transfer preparation failed: ${error}`);
      });
      return false;
    }
  }

  async createToken(
    tokenName: string,
    tokenSymbol: string,
    initialSupply: string,
    decimals: number,
    maxSupply: string,
    receipt: string,
    maxWalletAmount: string,
    maxTxLimit: string,
    mnemonicPhrases: string,
  ) {
    this.qrlStore.resetTransactionStatus();
    try {
      this.setCreatingToken(tokenName, true);
      const selectedBlockChain = await StorageUtil.getBlockChain();
      const { url } = QRL_PROVIDER[selectedBlockChain as keyof typeof QRL_PROVIDER];
      const seed = await deriveHexSeedAsync(mnemonicPhrases);
      const web3 = new Web3(new Web3.providers.HttpProvider(url));
      const acc = web3.qrl.accounts.seedToAccount(seed);
      web3.qrl.wallet?.add(seed);
      web3.qrl.transactionConfirmationBlocks = 1;

      const contractAddress = import.meta.env.VITE_CUSTOMERC20FACTORY_ADDRESS || "";

      if (!contractAddress) {
        throw new Error(
          "Factory contract address not configured. Please set VITE_CUSTOMERC20FACTORY_ADDRESS.",
        );
      }

      const factoryCode = await web3.qrl.getCode(contractAddress);
      if (!factoryCode || factoryCode === "0x" || factoryCode === "0x0") {
        throw new Error(
          `Factory contract not deployed at address: ${contractAddress}`,
        );
      }

      const confirmationHandler = () => {
        // Don't set creating to false here - confirmation can fire before tx is final.
        // Let receiptHandler and errorHandler manage the final state.
      };

      const receiptHandler = async (data: TransactionReceipt) => {
        const tokenCreatedEventSignature = web3.utils.keccak256(
          "TokenCreated(address,address)",
        );

        let tokenCreatedLog = data.logs.find(
          (logEntry) =>
            logEntry.topics?.[0] === tokenCreatedEventSignature &&
            logEntry.address?.toLowerCase() === contractAddress.toLowerCase(),
        );

        if (!tokenCreatedLog && data.blockNumber) {
          try {
            const logs = await web3.qrl.getPastLogs({
              fromBlock: data.blockNumber,
              toBlock: data.blockNumber,
              address: contractAddress,
              topics: [tokenCreatedEventSignature],
            });
            const txHash = data.transactionHash
              ? web3.utils.bytesToHex(data.transactionHash).toLowerCase()
              : null;
            const matchingLog = logs.find(
              (logEntry) =>
                typeof logEntry !== "string" &&
                txHash != null &&
                logEntry.transactionHash?.toLowerCase() === txHash,
            );
            if (matchingLog && typeof matchingLog !== "string") {
              tokenCreatedLog = matchingLog;
            }
          } catch (err) {
            console.error("Failed to fetch logs via getPastLogs:", err);
          }
        }

        if (!tokenCreatedLog?.topics?.[1]) {
          console.error("Token address not found in transaction receipt or logs");
          this.setCreatingToken(
            "",
            false,
            "Token address not found in transaction receipt",
          );
          return;
        }
        const tokenTopic = tokenCreatedLog.topics[1];
        const erc20TokenAddress = `Q${tokenTopic.toString().slice(-40)}`;
        const tx = data.transactionHash;
        const blockNumber = Number(data.blockNumber);
        const gasUsed = Number(data.gasUsed);
        const effectiveGasPrice = Number(data.effectiveGasPrice);
        const blockHash = data.blockHash;
        const { name, symbol, decimals: tokenDecimals } = await fetchTokenInfo(
          erc20TokenAddress,
          url,
        );
        this.setCreatedToken(
          name,
          symbol,
          parseInt(tokenDecimals.toString()),
          erc20TokenAddress,
          utils.bytesToHex(tx),
          blockNumber,
          gasUsed,
          effectiveGasPrice,
          utils.bytesToHex(blockHash),
        );
        this.setCreatingToken("", false);
      };

      const errorHandler = (error: Error) => {
        console.error("Token creation error:", error);
        this.setCreatingToken("", false, error.message || "Transaction failed");
      };

      const customERC20Factorycontract = new web3.qrl.Contract(
        customERC20FactoryABI,
        contractAddress,
      );

      const contractCreateToken =
        customERC20Factorycontract.methods.createToken(
          tokenName,
          tokenSymbol,
          initialSupply,
          decimals,
          maxSupply,
          receipt,
          maxWalletAmount,
          maxTxLimit,
        );

      const estimatedGas = await contractCreateToken.estimateGas({
        from: acc.address,
      });
      const gas = (estimatedGas * 12n) / 10n;
      const currentGasPrice = await web3.qrl.getGasPrice();
      const gasPrice = (BigInt(currentGasPrice) * 11n) / 10n;

      const txObj = {
        gas,
        gasPrice,
        from: acc.address,
        data: contractCreateToken.encodeABI(),
        to: contractAddress,
      };

      await web3.qrl
        .sendTransaction(txObj, undefined, {
          checkRevertBeforeSending: true,
        })
        .on("confirmation", confirmationHandler)
        .on("receipt", receiptHandler)
        .on("error", errorHandler);
    } catch (error) {
      console.error("Failed to create token:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Token creation failed";
      this.setCreatingToken("", false, errorMessage);
      throw error;
    }
  }

  async refreshTokenBalances() {
    try {
      const activeAccountAddress = this.qrlStore.activeAccount.accountAddress;
      if (!activeAccountAddress) return;

      const selectedBlockChain = await StorageUtil.getBlockChain();
      const updatedTokenList = [...this.tokenList];

      for (let i = 0; i < this.tokenList.length; i++) {
        const token = this.tokenList[i];
        try {
          const balance = await fetchBalance(
            token.address,
            activeAccountAddress,
            QRL_PROVIDER[selectedBlockChain as keyof typeof QRL_PROVIDER].url,
          );
          const balanceStr = formatUnits(balance, token.decimals);
          updatedTokenList[i] = {
            ...token,
            amount: getOptimalTokenBalance(balanceStr, token.symbol),
          };
        } catch (err) {
          console.error(
            `Error fetching balance for token ${token.symbol}:`,
            err,
          );
          updatedTokenList[i] = { ...token, amount: "Error" };
        }
      }

      await this.setTokenList(updatedTokenList);
    } catch (error) {
      console.error("Error refreshing token balances:", error);
    }
  }

  async discoverAndAddTokens(address: string) {
    try {
      const blockchain = this.qrlStore.qrlConnection.blockchain;
      if (!blockchain) {
        log("Cannot discover tokens: no blockchain selected");
        return;
      }

      log(`Starting token discovery for ${address}`);
      const discoveredTokens = await discoverTokens(address, blockchain);

      if (discoveredTokens.length === 0) {
        log("No new tokens discovered");
        return;
      }

      const mergedTokens = mergeTokenLists(this.tokenList, discoveredTokens);

      if (mergedTokens.length > this.tokenList.length) {
        const newCount = mergedTokens.length - this.tokenList.length;
        log(`Adding ${newCount} newly discovered tokens`);
        await this.setTokenList(mergedTokens);
      }
    } catch (error) {
      console.error("Error discovering tokens:", error);
      log(`Token discovery failed: ${error}`);
    }
  }

  async loadHiddenTokens() {
    const hiddenTokens = await StorageUtil.getHiddenTokens();
    runInAction(() => {
      this.hiddenTokens = hiddenTokens;
    });
  }

  async hideToken(tokenAddress: string) {
    await StorageUtil.hideToken(tokenAddress);
    runInAction(() => {
      const lowerCaseAddress = tokenAddress.toLowerCase();
      if (
        !this.hiddenTokens.some(
          (addr) => addr.toLowerCase() === lowerCaseAddress,
        )
      ) {
        this.hiddenTokens = [...this.hiddenTokens, lowerCaseAddress];
      }
    });
    log(`Token hidden: ${tokenAddress}`);
  }

  async unhideToken(tokenAddress: string) {
    await StorageUtil.unhideToken(tokenAddress);
    runInAction(() => {
      this.hiddenTokens = this.hiddenTokens.filter(
        (addr) => addr.toLowerCase() !== tokenAddress.toLowerCase(),
      );
    });
    log(`Token unhidden: ${tokenAddress}`);
  }
}

export default TokenStore;
