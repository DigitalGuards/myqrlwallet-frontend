import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { Loader2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import { Button } from "@/components/UI/Button";
import { Checkbox } from "@/components/UI/CheckBox";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { useStore } from "@/stores/store";
import { StorageUtil } from "@/utils/storage";
import { QRL_PROVIDER } from "@/config";
import {
  detectTokenStandard,
  fetchNftCollectionInfo,
  fetchNftMetadata,
  fetchOwned721Ids,
  fetchErc1155Balance,
  fetchTokenUri,
  isErc721Owner,
  nftKey,
  type NftCollectionInfo,
  type NftStandard,
} from "@/utils/web3/nft";
import { isValidQrlAddress } from "@/utils/web3";
import type { NFTInterface } from "@/constants";

interface AddNftModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddNftModal = observer(({ isOpen, onClose }: AddNftModalProps) => {
  const { qrlStore, nftStore } = useStore();
  const { accountAddress } = qrlStore.activeAccount;
  const { pendingDiscoveredNfts } = nftStore;

  const [contractAddress, setContractAddress] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [detection, setDetection] = useState<{
    standard: NftStandard;
    info: NftCollectionInfo;
  } | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingPicks, setIsAddingPicks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      // Reset on close so a fresh open is empty.
      setContractAddress("");
      setTokenId("");
      setDetection(null);
      setError(null);
      setIsDetecting(false);
      setIsAdding(false);
      setIsAddingPicks(false);
      setSelectedKeys(new Set());
    }
  }, [isOpen]);

  // Re-fire discovery on modal open so the picker is fresh even if the
  // NftGallery card mounted long ago.
  useEffect(() => {
    if (!isOpen || !accountAddress) return;
    void nftStore.discoverNftsForReview(accountAddress);
  }, [isOpen, accountAddress, nftStore]);

  // Lower-cased composite keys for the selection set, matching the
  // store's dedupe.
  const selectableKeys = useMemo(
    () =>
      pendingDiscoveredNfts.map((n) =>
        nftKey(n.contractAddress, n.tokenId).toLowerCase(),
      ),
    [pendingDiscoveredNfts],
  );

  // Prune selections if a discovered NFT has since been added elsewhere.
  useEffect(() => {
    setSelectedKeys((prev) => {
      const allow = new Set(selectableKeys);
      const next = new Set<string>();
      for (const k of prev) if (allow.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [selectableKeys]);

  const toggleSelection = (n: NFTInterface) => {
    const key = nftKey(n.contractAddress, n.tokenId).toLowerCase();
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addSelected = async () => {
    if (selectedKeys.size === 0) return;
    setIsAddingPicks(true);
    setError(null);
    try {
      const picks = pendingDiscoveredNfts.filter((n) =>
        selectedKeys.has(nftKey(n.contractAddress, n.tokenId).toLowerCase()),
      );
      await nftStore.addDiscoveredNfts(picks);
      setSelectedKeys(new Set());
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Failed to add picks: ${err.message}`
          : "Failed to add picks.",
      );
    } finally {
      setIsAddingPicks(false);
    }
  };

  // Re-run detection on contract-address change once the format looks valid.
  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      setDetection(null);
      if (!isValidQrlAddress(contractAddress)) return;
      setError(null);
      setIsDetecting(true);
      try {
        const blockchain = await StorageUtil.getBlockChain();
        const rpcUrl = QRL_PROVIDER[blockchain].url;
        const standard = await detectTokenStandard(contractAddress, rpcUrl);
        if (cancelled) return;
        if (!standard) {
          setError(
            "This address doesn't look like an ERC-721 or ERC-1155 contract.",
          );
          setIsDetecting(false);
          return;
        }
        const info = await fetchNftCollectionInfo(
          contractAddress,
          rpcUrl,
          standard,
        );
        if (cancelled) return;
        setDetection({ standard, info });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? `Detection failed: ${err.message}`
            : "Detection failed.",
        );
      } finally {
        if (!cancelled) setIsDetecting(false);
      }
    };
    detect();
    return () => {
      cancelled = true;
    };
  }, [contractAddress]);

  const onAdd = async () => {
    if (!detection) return;
    if (!accountAddress) {
      setError("Connect an account first.");
      return;
    }
    setIsAdding(true);
    setError(null);
    try {
      const blockchain = await StorageUtil.getBlockChain();
      const rpcUrl = QRL_PROVIDER[blockchain].url;

      let ids: string[] = [];
      // ERC-1155 balance cache so the metadata loop below doesn't re-fetch
      // a balance we already needed to check during the ownership gate.
      const balanceCache: Record<string, bigint> = {};
      if (detection.standard === "ERC721") {
        // Prefer enumeration when available.
        const enumerated = await fetchOwned721Ids(
          contractAddress,
          accountAddress,
          rpcUrl,
        );
        if (enumerated && enumerated.length > 0) {
          ids = enumerated;
        } else if (enumerated && enumerated.length === 0) {
          setError("This account doesn't own any token in that collection.");
          setIsAdding(false);
          return;
        } else {
          // Non-enumerable — fall back to user-supplied tokenId.
          if (!tokenId.trim()) {
            setError(
              "This contract doesn't expose ownership enumeration. Please enter a Token ID.",
            );
            setIsAdding(false);
            return;
          }
          const owned = await isErc721Owner(
            contractAddress,
            accountAddress,
            tokenId.trim(),
            rpcUrl,
          );
          if (!owned) {
            setError("This account does not own that token ID.");
            setIsAdding(false);
            return;
          }
          ids = [tokenId.trim()];
        }
      } else {
        // ERC-1155 requires explicit tokenId.
        if (!tokenId.trim()) {
          setError("ERC-1155 contracts need a Token ID.");
          setIsAdding(false);
          return;
        }
        const trimmedId = tokenId.trim();
        const balance = await fetchErc1155Balance(
          contractAddress,
          accountAddress,
          trimmedId,
          rpcUrl,
        );
        if (balance <= 0n) {
          setError("This account holds 0 of that token.");
          setIsAdding(false);
          return;
        }
        balanceCache[trimmedId] = balance;
        ids = [trimmedId];
      }

      // Resolve metadata for each id (best-effort; tolerant of failures).
      for (const id of ids) {
        let metaName: string | undefined;
        let metaImage: string | undefined;
        let metaDescription: string | undefined;
        try {
          const uri = await fetchTokenUri(
            contractAddress,
            id,
            rpcUrl,
            detection.standard,
          );
          if (uri) {
            const meta = await fetchNftMetadata(uri);
            metaName = meta?.name;
            metaImage = meta?.image;
            metaDescription = meta?.description;
          }
        } catch (err) {
          console.error(`fetchTokenUri/Metadata failed for ${id}:`, err);
        }

        const nft: NFTInterface = {
          contractAddress,
          standard: detection.standard,
          tokenId: id,
          collectionName: detection.info.name,
          collectionSymbol: detection.info.symbol,
          name: metaName,
          description: metaDescription,
          image: metaImage,
          balance:
            detection.standard === "ERC1155"
              ? (
                  balanceCache[id] ??
                  (await fetchErc1155Balance(
                    contractAddress,
                    accountAddress,
                    id,
                    rpcUrl,
                  ))
                ).toString()
              : undefined,
          fetchedAt: Date.now(),
        };
        await nftStore.addNft(nft);
      }

      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? `Add failed: ${err.message}` : "Add failed.",
      );
    } finally {
      setIsAdding(false);
    }
  };

  const needsTokenId =
    detection?.standard === "ERC1155" ||
    (detection?.standard === "ERC721" && !detection.info.supportsEnumerable);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add NFT</DialogTitle>
          <DialogDescription>
            Add an ERC-721 or ERC-1155 collectible to your wallet.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {pendingDiscoveredNfts.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-muted-foreground/70" />
              Discovered NFTs ({pendingDiscoveredNfts.length})
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              The explorer sees these on this address. Pick the ones to add;
              the rest stay off your gallery.
            </p>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {pendingDiscoveredNfts.map((n) => {
                const key = nftKey(
                  n.contractAddress,
                  n.tokenId,
                ).toLowerCase();
                const checked = selectedKeys.has(key);
                const titleLine =
                  n.name ||
                  `${n.collectionName || "Unknown collection"} #${n.tokenId}`;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-md border bg-background p-2"
                  >
                    <Checkbox
                      id={`discovered-nft-${key}`}
                      checked={checked}
                      onCheckedChange={() => toggleSelection(n)}
                      disabled={isAddingPicks}
                    />
                    {n.image ? (
                      <img
                        src={n.image}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                        <Sparkles className="h-4 w-4" />
                      </div>
                    )}
                    <Label
                      htmlFor={`discovered-nft-${key}`}
                      className="flex flex-1 cursor-pointer flex-col gap-0.5"
                    >
                      <span className="text-sm font-medium">{titleLine}</span>
                      <span className="text-xs text-muted-foreground">
                        {n.standard} · #{n.tokenId}
                        {n.balance && n.standard === "ERC1155"
                          ? ` · ×${n.balance}`
                          : ""}
                      </span>
                    </Label>
                  </li>
                );
              })}
            </ul>
            <Button
              type="button"
              size="sm"
              className="mt-3 w-full"
              disabled={selectedKeys.size === 0 || isAddingPicks}
              onClick={addSelected}
            >
              {isAddingPicks ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding…
                </>
              ) : (
                <>Add Selected ({selectedKeys.size})</>
              )}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="nft-contract">Contract Address</Label>
          <Input
            id="nft-contract"
            value={contractAddress}
            onChange={(e) => {
              setContractAddress(e.target.value.trim());
              setError(null);
            }}
            placeholder="Q…"
            disabled={isAdding}
          />
        </div>

        {isDetecting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Detecting contract standard…
          </div>
        )}

        {detection && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div>
              <span className="text-muted-foreground">Standard:</span>{" "}
              <span className="font-medium">{detection.standard}</span>
            </div>
            {detection.info.name && (
              <div>
                <span className="text-muted-foreground">Collection:</span>{" "}
                <span className="font-medium">
                  {detection.info.name}
                  {detection.info.symbol ? ` (${detection.info.symbol})` : ""}
                </span>
              </div>
            )}
            {detection.standard === "ERC721" && (
              <div>
                <span className="text-muted-foreground">
                  Owner enumeration:
                </span>{" "}
                <span className="font-medium">
                  {detection.info.supportsEnumerable ? "yes" : "no"}
                </span>
              </div>
            )}
          </div>
        )}

        {needsTokenId && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="nft-token-id">Token ID</Label>
            <Input
              id="nft-token-id"
              value={tokenId}
              onChange={(e) => {
                setTokenId(e.target.value.trim());
                setError(null);
              }}
              placeholder="e.g. 42"
              disabled={isAdding}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            className="w-full"
            disabled={!detection || isAdding || isDetecting}
            onClick={onAdd}
          >
            {isAdding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              "Add NFT"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
