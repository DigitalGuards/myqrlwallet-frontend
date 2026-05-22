import {
  action,
  computed,
  makeAutoObservable,
  observable,
  runInAction,
} from "mobx";
import Web3, { TransactionReceipt, utils } from "@theqrl/web3";
import { log } from "@/utils";
import { QRL_PROVIDER } from "@/config";
import { StorageUtil } from "@/utils/storage";
import { deriveHexSeedAsync } from "@/utils/crypto";
import { NFTInterface } from "@/constants";
import { erc721ABI } from "@/abi/ERC721ABI";
import { erc1155ABI } from "@/abi/ERC1155ABI";
import {
  fetchErc1155Balance,
  isErc721Owner,
  nftKey,
} from "@/utils/web3/nft";
import { discoverNFTs } from "@/utils/web3";
import type QrlStore from "./qrlStore";
import type TokenStore from "./tokenStore";
import { applyFeeLevel, type FeeLevel } from "./qrlStore";

class NftStore {
  nftList: NFTInterface[] = [];
  hiddenNfts: string[] = [];
  // Phase 3b opt-in: the explorer's view of what NFTs this address
  // holds. Populated by discoverNftsForReview(); never auto-merged into
  // nftList. The UI renders pendingDiscoveredNfts as picker rows so a
  // spam-airdropped NFT can't land in the gallery without an explicit
  // user pick.
  discoveredNfts: NFTInterface[] = [];

  constructor(
    private qrlStore: QrlStore,
    // Held for future cross-domain hooks (e.g. refresh after transfer
    // shares the transactionStatus surface). Currently unused; lint-
    // silenced by referencing it in the constructor body.
    private tokenStore: TokenStore,
  ) {
    makeAutoObservable(this, {
      nftList: observable.struct,
      hiddenNfts: observable,
      discoveredNfts: observable.struct,
      visibleNftList: computed,
      pendingDiscoveredNfts: computed,
      initialize: action.bound,
      handleActiveAccountChanged: action.bound,
      addNft: action.bound,
      removeNft: action.bound,
      hideNft: action.bound,
      unhideNft: action.bound,
      loadHiddenNfts: action.bound,
      setNftList: action.bound,
      refreshNftBalances: action.bound,
      transferNft: action.bound,
      discoverNftsForReview: action.bound,
      addDiscoveredNfts: action.bound,
      clearDiscoveredNfts: action.bound,
    });
    void this.tokenStore;
    log("NftStore initialized");
  }

  get visibleNftList(): NFTInterface[] {
    return this.nftList.filter(
      (nft) =>
        !this.hiddenNfts.some(
          (k) =>
            k.toLowerCase() === nftKey(nft.contractAddress, nft.tokenId),
        ),
    );
  }

  // Discovered NFTs minus the ones already in the user's saved gallery.
  // The "Add NFT" picker renders this list so previously-added items
  // don't reappear as suggestions.
  get pendingDiscoveredNfts(): NFTInterface[] {
    const owned = new Set(
      this.nftList.map((n) =>
        nftKey(n.contractAddress, n.tokenId).toLowerCase(),
      ),
    );
    return this.discoveredNfts.filter(
      (n) => !owned.has(nftKey(n.contractAddress, n.tokenId).toLowerCase()),
    );
  }

  // Storage is now keyed by `${blockchain}_${account}` (see StorageUtil)
  // so reads from the wrong scope are impossible — but we still need the
  // scope to write. Pulls live values from qrlStore at the call site.
  private get scope(): { blockchain: string; account: string } {
    return {
      blockchain: this.qrlStore.qrlConnection.blockchain,
      account: this.qrlStore.activeAccount.accountAddress,
    };
  }

  async initialize() {
    const { blockchain, account } = this.scope;
    const persisted = await StorageUtil.getNftList(blockchain, account);
    runInAction(() => {
      this.nftList = persisted;
    });
    await this.loadHiddenNfts();
  }

  async handleActiveAccountChanged(newActiveAccount?: string) {
    if (!newActiveAccount) {
      return;
    }
    // Storage is per-account-scoped, so an account switch just means
    // reloading from the new scope's key. No cross-account clearing
    // needed — the old account's list stays under its own key for when
    // the user switches back.
    const blockchain = this.qrlStore.qrlConnection.blockchain;
    const persisted = await StorageUtil.getNftList(blockchain, newActiveAccount);
    const hidden = await StorageUtil.getHiddenNfts(blockchain, newActiveAccount);
    runInAction(() => {
      this.nftList = persisted;
      this.hiddenNfts = hidden;
      // Discovered list is per-address; drop it so a picker opened
      // after the switch can't leak the prior account's results.
      this.discoveredNfts = [];
    });
  }

  async setNftList(list: NFTInterface[]) {
    const { blockchain, account } = this.scope;
    await StorageUtil.updateNftList(blockchain, account, list);
    runInAction(() => {
      this.nftList = list;
    });
  }

  async addNft(nft: NFTInterface) {
    const key = nftKey(nft.contractAddress, nft.tokenId);
    const existing = this.nftList.find(
      (n) => nftKey(n.contractAddress, n.tokenId) === key,
    );
    if (existing) {
      // If hidden, treat add-again as unhide.
      const isHidden = this.hiddenNfts.some(
        (k) => k.toLowerCase() === key,
      );
      if (isHidden) {
        await this.unhideNft(key);
      }
      return existing;
    }
    const next = [...this.nftList, nft];
    await this.setNftList(next);
    return nft;
  }

  async removeNft(key: string) {
    const next = this.nftList.filter(
      (n) => nftKey(n.contractAddress, n.tokenId) !== key.toLowerCase(),
    );
    await this.setNftList(next);
  }

  async loadHiddenNfts() {
    const { blockchain, account } = this.scope;
    const list = await StorageUtil.getHiddenNfts(blockchain, account);
    runInAction(() => {
      this.hiddenNfts = list;
    });
  }

  async hideNft(key: string) {
    const { blockchain, account } = this.scope;
    await StorageUtil.hideNft(blockchain, account, key);
    runInAction(() => {
      const lower = key.toLowerCase();
      if (!this.hiddenNfts.some((k) => k.toLowerCase() === lower)) {
        this.hiddenNfts = [...this.hiddenNfts, lower];
      }
    });
  }

  async unhideNft(key: string) {
    const { blockchain, account } = this.scope;
    await StorageUtil.unhideNft(blockchain, account, key);
    runInAction(() => {
      this.hiddenNfts = this.hiddenNfts.filter(
        (k) => k.toLowerCase() !== key.toLowerCase(),
      );
    });
  }

  /**
   * For each NFT in the list: confirm 721 ownership / refresh 1155
   * balance. Drops NFTs the wallet no longer owns (e.g. transferred
   * out from another client) so the gallery stays honest.
   */
  async refreshNftBalances() {
    const owner = this.qrlStore.activeAccount.accountAddress;
    if (!owner || this.nftList.length === 0) return;
    const selectedBlockChain = await StorageUtil.getBlockChain();
    const rpcUrl =
      QRL_PROVIDER[selectedBlockChain as keyof typeof QRL_PROVIDER].url;

    const updated: NFTInterface[] = [];
    for (const nft of this.nftList) {
      try {
        if (nft.standard === "ERC721") {
          const stillOwner = await isErc721Owner(
            nft.contractAddress,
            owner,
            nft.tokenId,
            rpcUrl,
          );
          if (stillOwner) {
            updated.push(nft);
          }
          // dropped if no longer owner
        } else {
          const bal = await fetchErc1155Balance(
            nft.contractAddress,
            owner,
            nft.tokenId,
            rpcUrl,
          );
          if (bal > 0n) {
            updated.push({ ...nft, balance: bal.toString() });
          }
          // dropped if balance == 0
        }
      } catch (err) {
        // Keep stale entries on transient errors so a flaky RPC doesn't
        // wipe the gallery; log + carry on.
        console.error(
          `refreshNftBalances: ${nft.contractAddress}#${nft.tokenId}`,
          err,
        );
        updated.push(nft);
      }
    }
    await this.setNftList(updated);
  }

  /**
   * Sign + broadcast safeTransferFrom for the supplied NFT. Writes
   * transaction state into qrlStore.transactionStatus so the existing
   * Transfer UX (status banners, history) just works.
   */
  async transferNft(
    nft: NFTInterface,
    toAddress: string,
    mnemonicPhrases: string,
    amount: bigint = 1n,
    feeLevel: FeeLevel = "medium",
  ): Promise<boolean> {
    this.qrlStore.resetTransactionStatus();
    try {
      const selectedBlockChain = await StorageUtil.getBlockChain();
      const { url } =
        QRL_PROVIDER[selectedBlockChain as keyof typeof QRL_PROVIDER];
      const web3 = new Web3(new Web3.providers.HttpProvider(url));
      const seed = await deriveHexSeedAsync(mnemonicPhrases);
      const acc = web3.qrl.accounts.seedToAccount(seed);
      web3.qrl.wallet?.add(seed);
      web3.qrl.transactionConfirmationBlocks = 1;

      const baseGasPrice =
        (await web3.qrl.getGasPrice()) ?? BigInt(1000000000);
      const { maxFeePerGas, maxPriorityFeePerGas } = applyFeeLevel(
        baseGasPrice,
        feeLevel,
      );

      let data: string;
      if (nft.standard === "ERC721") {
        const contract = new web3.qrl.Contract(
          erc721ABI as any,
          nft.contractAddress,
        );
        data = (contract.methods as any)
          .safeTransferFrom(acc.address, toAddress, nft.tokenId)
          .encodeABI();
      } else {
        const contract = new web3.qrl.Contract(
          erc1155ABI as any,
          nft.contractAddress,
        );
        data = (contract.methods as any)
          .safeTransferFrom(
            acc.address,
            toAddress,
            nft.tokenId,
            amount.toString(),
            "0x",
          )
          .encodeABI();
      }

      const txObj = {
        type: "0x2",
        from: acc.address,
        to: nft.contractAddress,
        data,
        maxFeePerGas,
        maxPriorityFeePerGas,
      } as const;

      // Let the node estimate gas to handle wildly varying ERC-1155
      // implementations; fall back to a sane 200k cap if estimation fails.
      let gas: bigint;
      try {
        const estimated = await web3.qrl.estimateGas({
          from: acc.address,
          to: nft.contractAddress,
          data,
        });
        gas = (BigInt(estimated) * 12n) / 10n;
      } catch (err) {
        log(`estimateGas failed for NFT transfer, using fallback: ${err}`);
        gas = 200_000n;
      }

      const finalTx = { ...txObj, gas };

      const promiEvent = web3.qrl.sendTransaction(finalTx, undefined, {
        checkRevertBeforeSending: true,
      });

      promiEvent
        .on("transactionHash", (hash: string | Uint8Array) => {
          runInAction(() => {
            const txHash =
              typeof hash === "string" ? hash : utils.bytesToHex(hash);
            this.qrlStore.transactionStatus = {
              state: "pending",
              txHash,
              receipt: null,
              error: null,
              pendingDetails: null,
            };
            log(`NFT transfer pending: ${txHash}`);
            this.qrlStore.fetchPendingTxDetails(txHash);
          });
        })
        .on("receipt", (receipt: TransactionReceipt) => {
          runInAction(() => {
            const txHashString = utils.bytesToHex(receipt.transactionHash);
            this.qrlStore.transactionStatus = {
              state: "confirmed",
              txHash: txHashString,
              receipt,
              error: null,
              pendingDetails: null,
            };
            log(`NFT transfer confirmed: ${txHashString}`);
            // Refresh ownership state so the transferred NFT drops out
            // of the gallery on its own.
            this.refreshNftBalances();
            this.qrlStore.fetchAccounts();
          });
        })
        .on("error", (error: Error) => {
          runInAction(() => {
            const txHash = this.qrlStore.transactionStatus.txHash;
            this.qrlStore.transactionStatus = {
              state: "failed",
              txHash,
              receipt: null,
              error: error.message || "NFT transfer failed",
              pendingDetails: null,
            };
            log(`NFT transfer failed: ${error.message}`);
          });
        });

      return true;
    } catch (error: any) {
      runInAction(() => {
        this.qrlStore.transactionStatus = {
          state: "failed",
          txHash: null,
          receipt: null,
          error: `NFT transfer failed: ${error.message || error}`,
          pendingDetails: null,
        };
        log(`NFT transfer preparation failed: ${error}`);
      });
      return false;
    }
  }

  /**
   * Phase 3b opt-in: populate `discoveredNfts` with what the explorer
   * sees this address holding, without auto-merging. The UI reads
   * pendingDiscoveredNfts to render an "Add NFT" picker; the user then
   * calls addDiscoveredNfts(picks). Returns the discovered list so
   * callers can render counts inline.
   */
  async discoverNftsForReview(address: string): Promise<NFTInterface[]> {
    const blockchain = this.qrlStore.qrlConnection.blockchain;
    if (!blockchain) {
      log("Cannot discover NFTs: no blockchain selected");
      return [];
    }
    // Synchronously reset before the await so any picker that observes
    // pendingDiscoveredNfts while the fetch is in flight sees an empty
    // list, not a stale one from a prior account or connection.
    runInAction(() => {
      this.discoveredNfts = [];
    });
    try {
      const discovered = await discoverNFTs(address, blockchain);
      runInAction(() => {
        this.discoveredNfts = discovered;
      });
      log(`NFT discovery for review: ${discovered.length} NFTs on ${address}`);
      return discovered;
    } catch (error) {
      console.error("discoverNftsForReview:", error);
      log(`discoverNftsForReview failed: ${error}`);
      runInAction(() => {
        this.discoveredNfts = [];
      });
      return [];
    }
  }

  /**
   * Explicit opt-in: merge the user-selected subset of discoveredNfts
   * into the persistent gallery. Dedupes against the existing list by
   * (contract, tokenID) so a pick already in the gallery is a no-op,
   * and writes the merged list in a single setNftList call.
   */
  async addDiscoveredNfts(picks: NFTInterface[]) {
    if (picks.length === 0) return;
    const owned = new Set(
      this.nftList.map((n) => nftKey(n.contractAddress, n.tokenId)),
    );
    const additions = picks.filter(
      (n) => !owned.has(nftKey(n.contractAddress, n.tokenId)),
    );
    if (additions.length === 0) return;
    await this.setNftList([...this.nftList, ...additions]);
    log(`Added ${additions.length} discovered NFTs to gallery`);
  }

  clearDiscoveredNfts() {
    runInAction(() => {
      this.discoveredNfts = [];
    });
  }
}

export default NftStore;
