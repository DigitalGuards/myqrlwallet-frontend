import { QRL_PROVIDER } from "@/config";
import { deriveHexSeedAsync } from "@/utils/crypto";
import { StorageUtil } from "@/utils/storage";
import { log } from "@/utils";
import type { TransactionReceipt } from "@theqrl/web3";
import { getQrlWeb3 } from "@/utils/web3";
import { action, computed, makeAutoObservable, observable, runInAction } from "mobx";
import { customERC20FactoryABI } from "@/abi/CustomERC20FactoryABI";
import { fetchTokenInfo, fetchBalance, discoverTokens, mergeTokenLists } from "@/utils/web3";
import { TokenInterface, KNOWN_TOKEN_LIST } from "@/constants";
import { customERC20ABI as CustomERC20ABI } from "@/abi/CustomERC20ABI";
const formatUnits = (value: bigint | string | unknown, decimals: number): string => {
  let v = BigInt(value as string | bigint);
  const isNegative = v < 0n;
  if (isNegative) v = -v;
  const divisor = BigInt(10) ** BigInt(decimals);
  const intPart = v / divisor;
  const fracPart = v % divisor;
  const prefix = isNegative ? '-' : '';
  if (fracPart === 0n) return `${prefix}${intPart}`;
  return `${prefix}${intPart}.${fracPart.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
};
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
  // Phase 3b opt-in: the explorer's view of what this address holds.
  // Populated by discoverTokensForReview(); never auto-merged into
  // tokenList. The UI surfaces these as picker rows ("Explorer
  // recognized N tokens, add?") so spam-airdropped tokens can't sneak
  // onto the dashboard without an explicit user pick.
  discoveredTokens: TokenInterface[] = [];
  // Drives the slot-machine cascade on the Amount column while
  // refreshTokenBalances is running. Kept on for ~1.2s after the
  // fetch resolves so the digits settle visibly.
  isRefreshingBalances = false;

  constructor(private qrlStore: QrlStore) {
    makeAutoObservable(this, {
      creatingToken: observable.struct,
      createdToken: observable.struct,
      tokenList: observable.struct,
      hiddenTokens: observable,
      discoveredTokens: observable.struct,
      isRefreshingBalances: observable,
      visibleTokenList: computed,
      pendingDiscoveredTokens: computed,
      setCreatingToken: action.bound,
      setCreatedToken: action.bound,
      addToken: action.bound,
      removeToken: action.bound,
      updateToken: action.bound,
      setTokenList: action.bound,
      sendToken: action.bound,
      createToken: action.bound,
      refreshTokenBalances: action.bound,
      setRefreshingBalances: action.bound,
      discoverAndAddTokens: action.bound,
      discoverTokensForReview: action.bound,
      addDiscoveredTokens: action.bound,
      clearDiscoveredTokens: action.bound,
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

  // Discovered tokens minus the ones the user has already added.
  // The "Add token" picker renders this filtered list so previously-added
  // entries don't reappear as suggestions, but hidden ones do — a hidden
  // token should be re-discoverable so the user can pick it again to
  // unhide. Lowercased comparison because the explorer normalises to
  // Q-prefix lowercase and a user's manual entries might be mixed case.
  get pendingDiscoveredTokens(): TokenInterface[] {
    const visible = new Set(
      this.visibleTokenList.map((t) => t.address.toLowerCase()),
    );
    return this.discoveredTokens.filter(
      (t) => !visible.has(t.address.toLowerCase()),
    );
  }

  // Token storage is now keyed by `${blockchain}_${account}` (see
  // StorageUtil), mirroring the NFT list. Reads from the wrong scope are
  // impossible, but we still need the scope to write. Pulls live values
  // from qrlStore at the call site.
  private get scope(): { blockchain: string; account: string } {
    return {
      blockchain: this.qrlStore.qrlConnection.blockchain,
      account: this.qrlStore.activeAccount.accountAddress,
    };
  }

  // Called by Store after QrlStore.initializeBlockchain finishes (via the
  // qrlStore.onBlockchainReady hook). Restores the persisted token list and
  // hidden-token list, then seeds known tokens.
  async initialize() {
    await this.migrateLegacyAutoAddedTokens();
    await this.migrateGlobalTokenListToAccount();
    const { blockchain, account } = this.scope;
    const persistedList = await StorageUtil.getTokenList(blockchain, account);
    
    // Seed KNOWN_TOKEN_LIST into the persisted list if not already present.
    // Use a local copy to avoid multiple re-renders and potential races
    // during the loop.
    const initialList = [...persistedList];
    const seen = new Set(initialList.map((t) => t.address.toLowerCase()));
    for (const token of KNOWN_TOKEN_LIST) {
      if (!seen.has(token.address.toLowerCase())) {
        initialList.push(token);
        seen.add(token.address.toLowerCase());
      }
    }

    runInAction(() => {
      this.tokenList = initialList;
    });

    // Also persist the merged list so KNOWN_TOKEN_LIST entries land in storage
    await StorageUtil.updateTokenList(blockchain, account, initialList);
    await this.loadHiddenTokens();
  }

  // One-shot migration: pre-gate (before PR #142), the wallet auto-merged
  // every token the explorer attributed to the active account into
  // tokenList, and persisted that to localStorage. After the gate, those
  // legacy entries can't be distinguished from user-curated picks — so we
  // wipe the legacy global TOKEN_LIST once on first load post-migration.
  // The discovery picker (PR #143) repopulates legitimate holdings on the
  // user's explicit say-so.
  private async migrateLegacyAutoAddedTokens() {
    const FLAG = "TOKEN_LIST_GATE_MIGRATED_V1";
    if (localStorage.getItem(FLAG)) return;
    StorageUtil.clearLegacyGlobalTokenData();
    localStorage.setItem(FLAG, "1");
    log("Migration: wiped pre-gate tokenList; flag set");
  }

  // One-shot migration: the token list used to live under a single global
  // key shared across every account/chain. It is now scoped per
  // `${blockchain}_${account}` like the NFT list. Move whatever the user
  // currently has under the global key into the active account's scope,
  // then drop the global key. Deferred (flag not set) until an account is
  // active so we never discard the legacy list before we can re-home it.
  private async migrateGlobalTokenListToAccount() {
    const FLAG = "TOKEN_LIST_PER_ACCOUNT_MIGRATED_V1";
    if (localStorage.getItem(FLAG)) return;
    const { blockchain, account } = this.scope;
    if (!blockchain || !account) return;

    const legacyTokens = StorageUtil.getLegacyGlobalTokenList();
    if (legacyTokens.length > 0) {
      const existing = await StorageUtil.getTokenList(blockchain, account);
      const seen = new Set(existing.map((t) => t.address.toLowerCase()));
      const merged = [
        ...existing,
        ...legacyTokens.filter((t) => !seen.has(t.address.toLowerCase())),
      ];
      await StorageUtil.updateTokenList(blockchain, account, merged);
    }

    const legacyHidden = StorageUtil.getLegacyGlobalHiddenTokens();
    for (const addr of legacyHidden) {
      await StorageUtil.hideToken(blockchain, account, addr);
    }

    StorageUtil.clearLegacyGlobalTokenData();
    localStorage.setItem(FLAG, "1");
    log(
      `Migration: moved ${legacyTokens.length} global tokens to ${blockchain}_${account}; flag set`,
    );
  }

  // Called by Store after QrlStore.setActiveAccount finishes (via the
  // qrlStore.onActiveAccountChanged hook).
  //
  // Anti-spam gate: this method intentionally does NOT call the explorer
  // to discover and auto-merge tokens. A silent merge would let any
  // airdropped token (or compromised explorer response) land on the
  // user's dashboard the moment they switched accounts, and renders the
  // attacker-supplied name/symbol verbatim. Discovery is now strictly
  // opt-in via discoverTokensForReview + the picker UI; KNOWN_TOKEN_LIST
  // stays as the curated allowlist bypass.
  async handleActiveAccountChanged(newActiveAccount?: string) {
    if (!newActiveAccount) {
      log("Active account cleared, skipping token refresh.");
      return;
    }

    log(`Switching token list to account: ${newActiveAccount}`);
    // Token storage is per-account-scoped, so an account switch just
    // means reloading from the new scope's key. No cross-account
    // clearing needed — the old account's list stays under its own key
    // for when the user switches back.
    const blockchain = this.qrlStore.qrlConnection.blockchain;
    const persisted = await StorageUtil.getTokenList(blockchain, newActiveAccount);
    const hidden = await StorageUtil.getHiddenTokens(blockchain, newActiveAccount);

    // Sync KNOWN_TOKEN_LIST into the persisted list for the new account.
    const initialList = [...persisted];
    const seen = new Set(initialList.map((t) => t.address.toLowerCase()));
    for (const token of KNOWN_TOKEN_LIST) {
      if (!seen.has(token.address.toLowerCase())) {
        initialList.push(token);
        seen.add(token.address.toLowerCase());
      }
    }

    runInAction(() => {
      this.tokenList = initialList;
      this.hiddenTokens = hidden;
      // Discovered list is per-address; drop it so a picker opened
      // after the switch can't leak the prior account's results.
      this.discoveredTokens = [];
    });

    // Persist the merged list for the new account scope
    await StorageUtil.updateTokenList(blockchain, newActiveAccount, initialList);

    // Refresh balances on whatever is in the list now (persisted picks +
    // KNOWN_TOKEN_LIST entries). No explorer call.
    void this.refreshTokenBalances();
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
      await this.setTokenList([...this.tokenList, token]);
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
    await this.setTokenList(
      this.tokenList.filter(
        (t) => t.address.toLowerCase() !== token.address.toLowerCase(),
      ),
    );
  }

  async updateToken(token: TokenInterface) {
    await this.setTokenList(
      this.tokenList.map((t) =>
        t.address.toLocaleLowerCase() === token.address.toLocaleLowerCase()
          ? token
          : t,
      ),
    );
  }

  async setTokenList(tokenList: TokenInterface[]) {
    const { blockchain, account } = this.scope;
    if (!blockchain || !account) return;

    // Update the observable immediately so concurrent calls see the new state.
    // Wrap in runInAction because we are in an async method.
    runInAction(() => {
      this.tokenList = tokenList;
    });

    // Persist to storage.
    await StorageUtil.updateTokenList(blockchain, account, tokenList);
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
      const { default: Web3, utils } = await getQrlWeb3();
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
      const { default: Web3, utils } = await getQrlWeb3();
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

  // The slot-cascade animation flag (isRefreshingBalances) is set by
  // callers, not here. Background invocations (account-switch auto-
  // refresh, etc.) refresh silently; only the user-pressed Refresh
  // button toggles the flag, so the digits don't spin on page load.
  async refreshTokenBalances() {
    try {
      const startAccount = this.qrlStore.activeAccount.accountAddress;
      if (!startAccount) return;

      // Freeze the list at entry and iterate the snapshot, not the
      // observable. If the user switches accounts mid-fetch, the
      // observable list will be wiped under us; the snapshot still
      // reflects what we set out to refresh.
      const snapshot = [...this.tokenList];
      const selectedBlockChain = await StorageUtil.getBlockChain();
      const rpcUrl = QRL_PROVIDER[selectedBlockChain as keyof typeof QRL_PROVIDER].url;

      const updatedTokenList = await Promise.all(
        snapshot.map(async (token) => {
          try {
            const balance = await fetchBalance(token.address, startAccount, rpcUrl);
            const balanceStr = formatUnits(balance, token.decimals);
            return {
              ...token,
              amount: getOptimalTokenBalance(balanceStr, token.symbol, false),
            };
          } catch (err) {
            console.error(`Error fetching balance for token ${token.symbol}:`, err);
            return { ...token, amount: "Error" };
          }
        })
      );

      // Stale-write guard: if the active account changed under us,
      // abandon the result. setTokenList writes to the current scope, so
      // a stale write would land balances computed for the old account
      // under the new account's key.
      if (this.qrlStore.activeAccount.accountAddress !== startAccount) {
        log(
          "refreshTokenBalances: active account changed mid-refresh, abandoning stale results",
        );
        return;
      }

      await this.setTokenList(updatedTokenList);
    } catch (error) {
      console.error("Error refreshing token balances:", error);
    }
  }

  // UI-owned setter for the slot-cascade animation flag. TokenForm
  // turns it on when the user clicks Refresh, off after the animation
  // tail. The fetch itself doesn't manage this flag — see
  // refreshTokenBalances comment.
  setRefreshingBalances(value: boolean) {
    this.isRefreshingBalances = value;
  }

  // Legacy auto-merge flow. Still wired into the Tokens-page refresh
  // button which intentionally rebuilds the list from chain state. New
  // UI flows should prefer discoverTokensForReview + addDiscoveredTokens
  // for an opt-in picker. The discovery URL now scopes to
  // standard=ERC-20, so this no longer auto-merges NFT rows, but it
  // still doesn't gate against spam-airdrop tokens.
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

  // Phase 3b opt-in discovery: populate `discoveredTokens` with whatever
  // the explorer can see on this address, without auto-merging. The UI
  // reads pendingDiscoveredTokens to render an "Add token" picker; the
  // user then calls addDiscoveredTokens(picks) with the ones they want.
  // Returns the discovered list so callers can render counts inline.
  async discoverTokensForReview(address: string): Promise<TokenInterface[]> {
    const blockchain = this.qrlStore.qrlConnection.blockchain;
    if (!blockchain) {
      log("Cannot discover tokens: no blockchain selected");
      return [];
    }
    // Synchronously reset before the await so any picker that observes
    // pendingDiscoveredTokens while the fetch is in flight sees an
    // empty list, not a stale one from a prior account or connection.
    runInAction(() => {
      this.discoveredTokens = [];
    });
    try {
      const discovered = await discoverTokens(address, blockchain);
      runInAction(() => {
        this.discoveredTokens = discovered;
      });
      log(
        `Token discovery for review: ${discovered.length} fungibles on ${address}`,
      );
      return discovered;
    } catch (error) {
      console.error("discoverTokensForReview:", error);
      log(`discoverTokensForReview failed: ${error}`);
      runInAction(() => {
        this.discoveredTokens = [];
      });
      return [];
    }
  }

  // Explicit opt-in: merge the user-selected subset of discoveredTokens
  // into the persistent tokenList. For picks already in the list-but-
  // hidden, this unhides them; for picks not in the list, this appends
  // them. Picks already visible are a no-op.
  async addDiscoveredTokens(picks: TokenInterface[]) {
    if (picks.length === 0) return;
    const startAccount = this.qrlStore.activeAccount.accountAddress;
    
    // Capture state once to ensure consistency during the loop
    const currentTokenList = [...this.tokenList];
    const currentHiddenTokens = [...this.hiddenTokens];
    
    const owned = new Set(currentTokenList.map((t) => t.address.toLowerCase()));
    const hidden = new Set(currentHiddenTokens.map((a) => a.toLowerCase()));
    
    const additions: TokenInterface[] = [];
    const unhides: string[] = [];
    
    for (const pick of picks) {
      const lower = pick.address.toLowerCase();
      if (!owned.has(lower)) {
        additions.push(pick);
        owned.add(lower); // Prevent duplicate additions within the same batch
      } else if (hidden.has(lower)) {
        unhides.push(pick.address);
      }
    }
    
    if (additions.length === 0 && unhides.length === 0) return;
    
    if (this.qrlStore.activeAccount.accountAddress !== startAccount) {
      log("addDiscoveredTokens: active account changed before write, abandoning picks");
      return;
    }
    
    const { blockchain, account } = this.scope;
    
    // 1. Handle additions (new tokens)
    if (additions.length > 0) {
      await this.setTokenList([...this.tokenList, ...additions]);
    }
    
    // 2. Handle unhides (existing but hidden tokens)
    if (unhides.length > 0) {
      // Persist unhides in storage
      for (const addr of unhides) {
        await StorageUtil.unhideToken(blockchain, account, addr);
      }
      
      // Stale-write guard: if the account changed while we were awaiting
      // storage writes, don't prune the current account's hiddenTokens.
      if (this.qrlStore.activeAccount.accountAddress !== startAccount) {
        log("addDiscoveredTokens: active account changed before unhide write, abandoning memory prune");
        return;
      }

      const drop = new Set(unhides.map((a) => a.toLowerCase()));
      runInAction(() => {
        this.hiddenTokens = this.hiddenTokens.filter(
          (addr) => !drop.has(addr.toLowerCase()),
        );
      });
    }
    
    log(`addDiscoveredTokens: added ${additions.length}, unhid ${unhides.length}`);
  }

  clearDiscoveredTokens() {
    runInAction(() => {
      this.discoveredTokens = [];
    });
  }

  async loadHiddenTokens() {
    const { blockchain, account } = this.scope;
    const hiddenTokens = await StorageUtil.getHiddenTokens(blockchain, account);
    runInAction(() => {
      this.hiddenTokens = hiddenTokens;
    });
  }

  async hideToken(tokenAddress: string) {
    const { blockchain, account } = this.scope;
    await StorageUtil.hideToken(blockchain, account, tokenAddress);
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
    const { blockchain, account } = this.scope;
    await StorageUtil.unhideToken(blockchain, account, tokenAddress);
    runInAction(() => {
      this.hiddenTokens = this.hiddenTokens.filter(
        (addr) => addr.toLowerCase() !== tokenAddress.toLowerCase(),
      );
    });
    log(`Token unhidden: ${tokenAddress}`);
  }
}

export default TokenStore;
