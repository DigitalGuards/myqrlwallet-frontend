import { useTranslation } from "react-i18next";
import { stringValue } from "@/utils/guards";
import { renderValue, toTemplateString } from "@/utils/guards";
import { reportError } from "@/utils/reportError";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { Button } from "@/components/UI/Button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { useStore } from "@/stores/store";
import {
  collectionDisplayName,
  collectionStandardLabel,
} from "@/utils/web3/nftCollections";
import { formatAddressFingerprint } from "@/utils/formatting";
import { NftCard } from "./NftCard";
import { NftCollectionRow } from "./NftCollectionRow";
import { AddNftModal } from "./AddNftModal";
import {
  NFT_COLLECTION_PARAM,
  openedFromCollectionList,
  type NftNavState,
} from "./nftNavigation";

const NftGallery = observer(() => {
  const { t } = useTranslation(["home", "tokens"]);
  const { qrlStore, nftStore } = useStore();
  const { accountAddress: activeAccountAddress } = qrlStore.activeAccount;
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // Lowercased contract address of the collection being browsed, or null
  // for the collection list. It lives in the URL so the drill-down is
  // addressable: an NFT detail page can navigate back into it, and the
  // browser Back button steps out of it. The derived lookup below
  // tolerates a collection that disappears under it (last token
  // transferred away, account switch) by falling back to the list.
  const openCollectionKey =
    searchParams.get(NFT_COLLECTION_PARAM)?.toLowerCase() || null;

  const openCollectionByKey = (key: string) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(NFT_COLLECTION_PARAM, key);
        return next;
      },
      { state: { nftCollectionFromList: true } satisfies NftNavState },
    );
  };

  const closeCollection = useCallback(
    (replace: boolean) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete(NFT_COLLECTION_PARAM);
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  // Pop the pushed entry when the list is one step back, so the in-app
  // Back button and the browser Back button land in the same place. A
  // drill-down reached by deep link, or by a detail page's fallback
  // navigation, has no such entry, so drop the parameter in place.
  const onBackToCollections = () => {
    if (openedFromCollectionList(location.state)) {
      Promise.resolve(navigate(-1)).catch((error: unknown) => {
        reportError("Failed to navigate back:", error);
      });
      return;
    }
    closeCollection(true);
  };

  // Refresh ownership/balances on mount so a stale list gets corrected
  // when the wallet has been used elsewhere since the last visit, then
  // re-resolve metadata for entries that never fetched or aged past the
  // TTL, so on-chain tokenURI changes (and first-fetch IPFS failures)
  // heal without a remove/re-add.
  useEffect(() => {
    (async () => {
      await nftStore.refreshNftBalances();
      await nftStore.refreshNftMetadata();
    })().catch((error: unknown) => {
      reportError("Failed to refresh NFTs:", error);
    });
  }, [nftStore]);

  // Close an open collection when its account changes. On first mount,
  // preserve the collection requested by a deep link.
  const lastAccountRef = useRef(activeAccountAddress);
  useEffect(() => {
    if (!activeAccountAddress) return;
    if (lastAccountRef.current !== activeAccountAddress) {
      lastAccountRef.current = activeAccountAddress;
      if (openCollectionKey) closeCollection(true);
    }
  }, [activeAccountAddress, openCollectionKey, closeCollection]);

  // Populate the review picker once per account; adding remains an explicit choice.
  useEffect(() => {
    if (!activeAccountAddress) return;
    nftStore
      .discoverNftsForReview(activeAccountAddress)
      .catch((error: unknown) => {
        reportError("Failed to discover NFTs:", error);
      });
  }, [activeAccountAddress, nftStore]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Ownership first (may drop entries), then force-refresh metadata
      // for whatever survived.
      await nftStore.refreshNftBalances();
      await nftStore.refreshNftMetadata(true);
    } catch (error) {
      reportError("Failed to refresh NFTs:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const collections = nftStore.nftCollections;
  const openCollection =
    collections.find((collection) => collection.key === openCollectionKey) ??
    null;

  const headerCount = openCollection
    ? t("home:items", { count: openCollection.tokenCount })
    : t("home:collections", { count: collections.length });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {openCollection && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={t("home:backCollections")}
              onClick={onBackToCollections}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <CardTitle className="truncate text-2xl font-bold">
            {renderValue(
              openCollection
                ? collectionDisplayName(openCollection)
                : t("home:nfts"),
            )}
          </CardTitle>
          {collections.length > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {headerCount}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void onRefresh();
                  }}
                  disabled={isRefreshing}
                  aria-label={t("home:nftRefresh")}
                >
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("home:nftRefresh")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsAddOpen(true);
            }}
            aria-label={t("home:addNft")}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {openCollection ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {collectionStandardLabel(openCollection.standard)} ·{" "}
              {formatAddressFingerprint(openCollection.contractAddress)}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {openCollection.tokens.map((nft) => (
                <NftCard
                  key={`${stringValue(nft.contractAddress).toLowerCase()}:${toTemplateString(nft.tokenId)}`}
                  nft={nft}
                />
              ))}
            </div>
          </div>
        ) : collections.length === 0 ? (
          <EmptyState
            onAdd={() => {
              setIsAddOpen(true);
            }}
            discoveredCollectionCount={
              nftStore.pendingDiscoveredNftCollections.length
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {collections.map((collection) => (
              <NftCollectionRow
                key={collection.key}
                collection={collection}
                onOpen={(picked) => {
                  openCollectionByKey(picked.key);
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
      <AddNftModal
        isOpen={isAddOpen}
        onClose={() => {
          setIsAddOpen(false);
        }}
      />
    </Card>
  );
});

function EmptyState({
  onAdd,
  discoveredCollectionCount,
}: {
  onAdd: () => void;
  discoveredCollectionCount: number;
}) {
  const { t } = useTranslation(["home", "tokens"]);
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      {discoveredCollectionCount > 0 ? (
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-muted-foreground/70" />
          {t("home:foundCollections", { count: discoveredCollectionCount })}
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium">{t("home:noNfts")}</p>
          <p className="text-xs text-muted-foreground">{t("home:nftHint")}</p>
        </div>
      )}
      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" />
        {discoveredCollectionCount > 0 ? t("tokens:review") : t("home:addNft")}
      </Button>
    </div>
  );
}

export default NftGallery;
