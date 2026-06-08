import { useNavigate } from "react-router-dom";
import { EyeOff } from "lucide-react";
import type { NFTInterface } from "@/constants";
import { Button } from "@/components/UI/Button";
import { useStore } from "@/stores/store";
import { nftKey } from "@/utils/web3/nft";
import { NftImage } from "./NftImage";
import { ROUTES } from "@/router/router";

interface NftCardProps {
  nft: NFTInterface;
}

export function NftCard({ nft }: NftCardProps) {
  const { nftStore } = useStore();
  const navigate = useNavigate();
  const key = nftKey(nft.contractAddress, nft.tokenId);

  const onHide = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await nftStore.hideNft(key);
  };

  const onOpen = () => {
    navigate(
      `${ROUTES.NFT_DETAIL.replace(":contractAddress", nft.contractAddress).replace(":tokenId", nft.tokenId)}`,
    );
  };

  const subtitle = nft.collectionName
    ? `${nft.collectionName} • #${truncateId(nft.tokenId)}`
    : `${truncateAddress(nft.contractAddress)} • #${truncateId(nft.tokenId)}`;

  return (
    <div className="group flex cursor-pointer flex-col gap-2" onClick={onOpen}>
      <div className="relative overflow-hidden rounded-md border border-border transition-colors group-hover:border-secondary/60">
        <NftImage
          src={nft.image}
          alt={nft.name ?? `Token #${nft.tokenId}`}
          blur
          className="aspect-square w-full bg-gradient-to-br from-secondary/15 to-background"
        />
        <Button
          variant="ghost"
          size="icon"
          title="Hide NFT"
          onClick={onHide}
          // Always visible on touch devices (no hover); reveal on hover on desktop.
          className="absolute right-2 top-2 h-7 w-7 bg-background/70 opacity-100 backdrop-blur-sm transition-opacity md:opacity-0 md:group-hover:opacity-100"
        >
          <EyeOff className="h-4 w-4" />
        </Button>
        {nft.standard === "ERC1155" && nft.balance && BigInt(nft.balance) > 1n && (
          <span className="absolute bottom-2 left-2 rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium backdrop-blur-sm">
            ×{nft.balance}
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        <div className="truncate text-sm font-medium">
          {nft.name ?? `Token #${truncateId(nft.tokenId)}`}
        </div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function truncateId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
