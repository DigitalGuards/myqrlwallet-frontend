import { ChevronRight, Images } from "lucide-react";
import {
  collectionDisplayName,
  collectionStandardLabel,
  type NftCollectionGroup,
} from "@/utils/web3/nftCollections";
import { formatAddressFingerprint } from "@/utils/formatting";
import { NftImage } from "./NftImage";

interface NftCollectionRowProps {
  collection: NftCollectionGroup;
  onOpen: (collection: NftCollectionGroup) => void;
}

/**
 * One collection in the gallery list: cover art from the first token
 * that has any, the collection name and symbol, how many items the
 * account owns, the standard, and the contract address in short form.
 */
export function NftCollectionRow({
  collection,
  onOpen,
}: NftCollectionRowProps) {
  const title = collectionDisplayName(collection);
  const cover = collection.tokens.find((token) => token.image)?.image;

  return (
    <button
      type="button"
      onClick={() => onOpen(collection)}
      className="group flex w-full items-center gap-3 rounded-md border border-border bg-background p-3 text-left outline-none transition-colors hover:border-secondary/60 focus-visible:ring-2 focus-visible:ring-secondary"
    >
      {cover ? (
        <NftImage
          src={cover}
          alt=""
          className="h-12 w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <Images className="h-5 w-5" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-sm font-medium">
          {title}
          {collection.symbol && collection.name && (
            <span className="ml-1 text-muted-foreground">
              ({collection.symbol})
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {collection.tokenCount} item{collection.tokenCount === 1 ? "" : "s"} ·{" "}
          {collectionStandardLabel(collection.standard)} ·{" "}
          {formatAddressFingerprint(collection.contractAddress)}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-secondary" />
    </button>
  );
}
