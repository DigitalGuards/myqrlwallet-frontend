import { useNavigate } from "react-router-dom";
import { EyeOff } from "lucide-react";
import { NFTInterface } from "@/constants";
import { Card } from "@/components/UI/Card";
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
    <Card
      className="group relative cursor-pointer overflow-hidden border-l-4 border-l-secondary transition-shadow hover:shadow-md"
      onClick={onOpen}
    >
      <NftImage
        src={nft.image}
        alt={nft.name ?? `Token #${nft.tokenId}`}
        className="aspect-square w-full"
      />
      <div className="space-y-1 p-3">
        <div className="truncate text-sm font-semibold">
          {nft.name ?? `Token #${truncateId(nft.tokenId)}`}
        </div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        {nft.standard === "ERC1155" && nft.balance && BigInt(nft.balance) > 1n && (
          <div className="text-xs text-muted-foreground">
            Balance: {nft.balance}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        title="Hide NFT"
        onClick={onHide}
        className="absolute right-2 top-2 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <EyeOff className="h-4 w-4" />
      </Button>
    </Card>
  );
}

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function truncateId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
