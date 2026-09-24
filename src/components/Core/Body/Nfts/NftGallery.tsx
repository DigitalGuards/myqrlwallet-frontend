import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
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

const NftGallery = observer(() => {
  const { qrlStore, nftStore } = useStore();
  const { accountAddress: activeAccountAddress } = qrlStore.activeAccount;
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Lowercased contract address of the collection being browsed, or null
  // for the collection list. Derived lookup below tolerates a collection
  // that disappears under it (last token transferred away, account
  // switch) by falling back to the list.
  const [openCollectionKey, setOpenCollectionKey] = useState<string | null>(
    null,
  );

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
  useEffect(() => {
    if (!activeAccountAddress) return;
    setOpenCollectionKey(null);
    void nftStore.discoverNftsForReview(activeAccountAddress);
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
              onClick={() => setOpenCollectionKey(null)}
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
                onOpen={(picked) => setOpenCollectionKey(picked.key)}
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
