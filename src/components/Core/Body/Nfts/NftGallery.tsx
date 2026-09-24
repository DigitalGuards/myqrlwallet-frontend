import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
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

  const closeCollection = (replace: boolean) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(NFT_COLLECTION_PARAM);
        return next;
      },
      { replace },
    );
  };

  // Pop the pushed entry when the list is one step back, so the in-app
  // Back button and the browser Back button land in the same place. A
  // drill-down reached by deep link, or by a detail page's fallback
  // navigation, has no such entry, so drop the parameter in place.
  const onBackToCollections = () => {
    if (openedFromCollectionList(location.state)) {
      void navigate(-1);
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
    void (async () => {
      await nftStore.refreshNftBalances();
      await nftStore.refreshNftMetadata();
    })();
  }, [nftStore]);

  // Populate the discovery cache so the empty-state can say "Explorer
  // found N collections" and the AddNftModal can offer a picker. Does
  // NOT auto-merge into nftList: the user has to explicitly pick.
  //
  // The same effect closes an open drill-down, because the collection
  // belongs to the account that was active when it was opened. That is
  // for an actual account switch only: on first mount the parameter is
  // what a deep link asked for, so clearing it there would defeat the
  // link.
  const lastAccountRef = useRef(activeAccountAddress);
  useEffect(() => {
    if (!activeAccountAddress) return;
    if (lastAccountRef.current !== activeAccountAddress) {
      lastAccountRef.current = activeAccountAddress;
      if (openCollectionKey) closeCollection(true);
    }
    void nftStore.discoverNftsForReview(activeAccountAddress);
    // Deliberately keyed on the account alone: re-running this on every
    // URL change would repeat the discovery fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountAddress, nftStore]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Ownership first (may drop entries), then force-refresh metadata
      // for whatever survived.
      await nftStore.refreshNftBalances();
      await nftStore.refreshNftMetadata(true);
    } finally {
      setIsRefreshing(false);
    }
  };

  const collections = nftStore.nftCollections;
  const openCollection =
    collections.find((collection) => collection.key === openCollectionKey) ??
    null;

  const headerCount = openCollection
    ? `${openCollection.tokenCount} item${openCollection.tokenCount === 1 ? "" : "s"}`
    : `${collections.length} collection${collections.length === 1 ? "" : "s"}`;

  return (
    <Card >
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {openCollection && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="Back to collections"
              onClick={onBackToCollections}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <CardTitle className="truncate text-2xl font-bold">
            {openCollection ? collectionDisplayName(openCollection) : "NFTs"}
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
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  aria-label="Refresh ownership, balances, and metadata"
                >
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh ownership, balances, and metadata</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddOpen(true)}
            aria-label="Add NFT"
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
                  key={`${nft.contractAddress.toLowerCase()}:${nft.tokenId}`}
                  nft={nft}
                />
              ))}
            </div>
          </div>
        ) : collections.length === 0 ? (
          <EmptyState
            onAdd={() => setIsAddOpen(true)}
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
                onOpen={(picked) => openCollectionByKey(picked.key)}
              />
            ))}
          </div>
        )}
      </CardContent>
      <AddNftModal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} />
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
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      {discoveredCollectionCount > 0 ? (
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-muted-foreground/70" />
          Explorer found this address to own{" "}
          <span className="font-medium">{discoveredCollectionCount}</span> NFT
          collection
          {discoveredCollectionCount === 1 ? "" : "s"}.
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium">No collectibles yet</p>
          <p className="text-xs text-muted-foreground">
            Paste an ERC-721 or ERC-1155 contract address to add one.
          </p>
        </div>
      )}
      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus className="mr-2 h-4 w-4" />
        {discoveredCollectionCount > 0 ? "Review and add" : "Add NFT"}
      </Button>
    </div>
  );
}

export default NftGallery;
