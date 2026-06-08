import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
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
import { NftCard } from "./NftCard";
import { AddNftModal } from "./AddNftModal";

const NftGallery = observer(() => {
  const { qrlStore, nftStore } = useStore();
  const { accountAddress: activeAccountAddress } = qrlStore.activeAccount;
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Refresh ownership/balances on mount so a stale list gets corrected
  // when the wallet has been used elsewhere since the last visit.
  useEffect(() => {
    void nftStore.refreshNftBalances();
  }, [nftStore]);

  // Populate the discovery cache so the empty-state can say "Explorer
  // found N NFTs" and the AddNftModal can offer a picker. Does NOT
  // auto-merge into nftList — the user has to explicitly pick.
  useEffect(() => {
    if (!activeAccountAddress) return;
    void nftStore.discoverNftsForReview(activeAccountAddress);
  }, [activeAccountAddress, nftStore]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      await nftStore.refreshNftBalances();
    } finally {
      setIsRefreshing(false);
    }
  };

  const nfts = nftStore.visibleNftList;

  return (
    <Card className="border-l-4 border-l-secondary">
      <CardHeader className="flex flex-row items-center justify-between bg-gradient-to-r from-secondary/5 to-transparent">
        <div className="flex items-center gap-3">
          <CardTitle className="text-2xl font-bold">NFTs</CardTitle>
          {nfts.length > 0 && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {nfts.length} item{nfts.length === 1 ? "" : "s"}
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
                  aria-label="Refresh NFT ownership"
                >
                  {isRefreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh ownership and balances</p>
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
        {nfts.length === 0 ? (
          <EmptyState
            onAdd={() => setIsAddOpen(true)}
            discoveredCount={nftStore.pendingDiscoveredNfts.length}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {nfts.map((nft) => (
              <NftCard
                key={`${nft.contractAddress.toLowerCase()}:${nft.tokenId}`}
                nft={nft}
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
  discoveredCount,
}: {
  onAdd: () => void;
  discoveredCount: number;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      {discoveredCount > 0 ? (
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-muted-foreground/70" />
          Explorer found this address to own{" "}
          <span className="font-medium">{discoveredCount}</span> NFT
          {discoveredCount === 1 ? "" : "s"}.
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
        {discoveredCount > 0 ? "Review and add" : "Add NFT"}
      </Button>
    </div>
  );
}

export default NftGallery;
