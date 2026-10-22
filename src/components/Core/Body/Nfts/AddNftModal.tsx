import { assetMessage, type AssetMessage } from "@/i18n/assetMessage";
import { useTranslation } from "react-i18next";
import { blockchainKey } from "@/utils/storage/storage";
import { renderValue, stringAttribute } from "@/utils/guards";
import { reportError } from "@/utils/reportError";
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
  type NftCollectionInfo,
  type NftStandard,
} from "@/utils/web3/nft";
import { isValidQrlAddress } from "@/utils/web3";
import {
  collectionDisplayName,
  collectionStandardLabel,
} from "@/utils/web3/nftCollections";
import { formatAddressFingerprint } from "@/utils/formatting";
import type { NFTInterface } from "@/constants";

interface AddNftModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddNftModal = observer(({ isOpen, onClose }: AddNftModalProps) => {
  const { t } = useTranslation([
    "creation",
    "nfts",
    "tokens",
    "home",
    "transfer",
    "settings",
    "onboarding",
    "common",
  ]);
  const { qrlStore, nftStore } = useStore();
  const { accountAddress } = qrlStore.activeAccount;
  const pendingCollections = nftStore.pendingDiscoveredNftCollections;

  const [contractAddress, setContractAddress] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [detection, setDetection] = useState<{
    standard: NftStandard;
    info: NftCollectionInfo;
  } | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingPicks, setIsAddingPicks] = useState(false);
  const [error, setError] = useState<AssetMessage | null>(null);
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
    nftStore.discoverNftsForReview(accountAddress).catch((error: unknown) => {
      reportError("Failed to discover NFTs:", error);
    });
  }, [isOpen, accountAddress, nftStore]);

  // Selection is per collection, keyed by lowercased contract address.
  const selectableKeys = useMemo(
    () => pendingCollections.map((collection) => collection.key),
    [pendingCollections],
  );

  // Prune selections if a discovered collection has since been added
  // elsewhere.
  useEffect(() => {
    setSelectedKeys((prev) => {
      const allow = new Set(selectableKeys);
      const next = new Set<string>();
      for (const k of prev) if (allow.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [selectableKeys]);

  const toggleSelection = (key: string) => {
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
      const picks = pendingCollections.filter((collection) =>
        selectedKeys.has(collection.key),
      );
      await nftStore.addDiscoveredCollections(picks);
      setSelectedKeys(new Set());
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? { key: "nfts:addPicksReason", reason: err.message }
          : { key: "nfts:addPicksFailed" },
      );
    } finally {
      setIsAddingPicks(false);
    }
  };

  // Re-run detection on contract-address change once the format looks valid.
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const detect = async () => {
      setDetection(null);
      if (!isValidQrlAddress(contractAddress)) return;
      setError(null);
      setIsDetecting(true);
      try {
        const blockchain = await StorageUtil.getBlockChain();
        const rpcUrl = QRL_PROVIDER[blockchainKey(blockchain)].url;
        const standard = await detectTokenStandard(contractAddress, rpcUrl);
        if (isCancelled()) return;
        if (!standard) {
          setError({ key: "nfts:unsupported" });
          setIsDetecting(false);
          return;
        }
        const info = await fetchNftCollectionInfo(
          contractAddress,
          rpcUrl,
          standard,
        );
        if (isCancelled()) return;
        setDetection({ standard, info });
      } catch (err) {
        if (isCancelled()) return;
        setError(
          err instanceof Error
            ? { key: "nfts:detectionReason", reason: err.message }
            : { key: "nfts:detectionFailed" },
        );
      } finally {
        if (!isCancelled()) setIsDetecting(false);
      }
    };
    void detect();
    return () => {
      cancelled = true;
    };
  }, [contractAddress]);

  const onAdd = async () => {
    if (!detection) return;
    if (!accountAddress) {
      setError({ key: "nfts:accountRequired" });
      return;
    }
    setIsAdding(true);
    setError(null);
    try {
      const blockchain = await StorageUtil.getBlockChain();
      const rpcUrl = QRL_PROVIDER[blockchainKey(blockchain)].url;

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
          setError({ key: "nfts:emptyCollection" });
          setIsAdding(false);
          return;
        } else {
          // Non-enumerable: fall back to user-supplied tokenId.
          if (!tokenId.trim()) {
            setError({ key: "nfts:manualId" });
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
            setError({ key: "nfts:wrongOwner" });
            setIsAdding(false);
            return;
          }
          ids = [tokenId.trim()];
        }
      } else {
        // ERC-1155 requires explicit tokenId.
        if (!tokenId.trim()) {
          setError({ key: "nfts:id1155" });
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
          setError({ key: "nfts:zeroBalance" });
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
        // Only stamped when the metadata JSON actually resolved. A failed
        // fetch leaves it undefined so nftStore.refreshNftMetadata retries
        // on the next gallery visit instead of waiting out the TTL.
        let metaFetchedAt: number | undefined;
        try {
          const uri = await fetchTokenUri(
            contractAddress,
            id,
            rpcUrl,
            detection.standard,
          );
          if (uri) {
            const meta = await fetchNftMetadata(uri);
            if (meta) {
              metaName = meta.name;
              metaImage = meta.image;
              metaDescription = meta.description;
              metaFetchedAt = Date.now();
            }
          }
        } catch (err) {
          reportError(`fetchTokenUri/Metadata failed for ${id}:`, err);
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
          fetchedAt: metaFetchedAt,
        };
        await nftStore.addNft(nft);
      }

      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? { key: "nfts:addReason", reason: err.message }
          : { key: "nfts:addFailed" },
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
          <DialogTitle>{t("nfts:add")}</DialogTitle>
          <DialogDescription>{t("nfts:addHint")}</DialogDescription>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
          >
            {assetMessage(error, t)}
          </div>
        )}

        {pendingCollections.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-muted-foreground/70" />
              {t("nfts:discovered", { count: pendingCollections.length })}
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("nfts:discoveredHint")}
            </p>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {pendingCollections.map((collection) => {
                const key = collection.key;
                const checked = selectedKeys.has(key);
                const cover = collection.tokens.find(
                  (token) => token.image,
                )?.image;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-md border bg-background p-2"
                  >
                    <Checkbox
                      id={`discovered-collection-${key}`}
                      checked={checked}
                      onCheckedChange={() => {
                        toggleSelection(key);
                      }}
                      disabled={isAddingPicks}
                    />
                    {cover ? (
                      <img
                        src={stringAttribute(cover)}
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
                      htmlFor={`discovered-collection-${key}`}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
                    >
                      <span className="truncate text-sm font-medium">
                        {renderValue(collectionDisplayName(collection))}
                        {renderValue(
                          collection.symbol && collection.name && (
                            <span className="ml-1 text-muted-foreground">
                              ({renderValue(collection.symbol)})
                            </span>
                          ),
                        )}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {t("nfts:items", { count: collection.tokenCount })} ·{" "}
                        {collectionStandardLabel(collection.standard)} ·{" "}
                        {formatAddressFingerprint(collection.contractAddress)}
                        {collection.truncated
                          ? t("nfts:firstAdded", {
                              count: collection.tokens.length,
                            })
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
              onClick={() => {
                void addSelected();
              }}
            >
              {isAddingPicks ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("tokens:adding")}
                </>
              ) : (
                <>{t("tokens:addSelected", { count: selectedKeys.size })}</>
              )}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="nft-contract">{t("nfts:contractAddress")}</Label>
          <Input
            id="nft-contract"
            value={contractAddress}
            onChange={(e) => {
              setContractAddress(e.target.value.trim());
              setError(null);
            }}
            placeholder={t("nfts:contractPlaceholder")}
            disabled={isAdding}
          />
        </div>

        {isDetecting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("nfts:detecting")}
          </div>
        )}

        {detection && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div>
              <span className="text-muted-foreground">
                {t("nfts:standardLabel")}
              </span>{" "}
              <span className="font-medium">{detection.standard}</span>
            </div>
            {detection.info.name && (
              <div>
                <span className="text-muted-foreground">
                  {t("nfts:collectionLabel")}
                </span>{" "}
                <span className="font-medium">
                  {detection.info.name}
                  {detection.info.symbol ? ` (${detection.info.symbol})` : ""}
                </span>
              </div>
            )}
            {detection.standard === "ERC721" && (
              <div>
                <span className="text-muted-foreground">
                  {t("nfts:ownerEnumeration")}
                </span>{" "}
                <span className="font-medium">
                  {detection.info.supportsEnumerable
                    ? t("nfts:yes")
                    : t("nfts:no")}
                </span>
              </div>
            )}
          </div>
        )}

        {needsTokenId && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="nft-token-id">{t("nfts:tokenId")}</Label>
            <Input
              id="nft-token-id"
              value={tokenId}
              onChange={(e) => {
                setTokenId(e.target.value.trim());
                setError(null);
              }}
              placeholder={t("nfts:idPlaceholder")}
              disabled={isAdding}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            className="w-full"
            disabled={!detection || isAdding || isDetecting}
            onClick={() => {
              void onAdd();
            }}
          >
            {isAdding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("tokens:adding")}
              </>
            ) : (
              t("nfts:add")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
