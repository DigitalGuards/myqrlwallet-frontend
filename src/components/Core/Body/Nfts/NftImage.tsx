import { useMemo, useState } from "react";
import { Skeleton } from "@/components/UI/skeleton";
import { ImageIcon } from "lucide-react";
import { resolveIpfsUri } from "@/utils/web3/nft";

interface NftImageProps {
  src?: string;
  alt: string;
  className?: string;
}

export function NftImage({ src, alt, className }: NftImageProps) {
  // Compute the resolved URL from props; derived, not stored. When `src`
  // changes the outer component re-renders with a new memoized value and
  // the inner <Inner> remounts via its key, resetting load/error state.
  const imageSrc = useMemo(
    () => (src ? resolveIpfsUri(src) : null),
    [src],
  );
  const wrapper = `relative overflow-hidden bg-muted ${className ?? ""}`;
  if (!imageSrc) {
    return <Fallback wrapper={wrapper} alt={alt} />;
  }
  return <Inner key={imageSrc} wrapper={wrapper} src={imageSrc} alt={alt} />;
}

function Inner({
  wrapper,
  src,
  alt,
}: {
  wrapper: string;
  src: string;
  alt: string;
}) {
  // Component is keyed by src, so this state always resets on src change.
  // setState only fires from <img> event callbacks — never inside an effect.
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );

  if (status === "error") {
    return <Fallback wrapper={wrapper} alt={alt} />;
  }

  return (
    <div className={wrapper}>
      {status === "loading" && <Skeleton className="absolute inset-0" />}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={`h-full w-full object-cover transition-opacity ${
          status === "loaded" ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

function Fallback({ wrapper, alt }: { wrapper: string; alt: string }) {
  return (
    <div
      className={`${wrapper} flex items-center justify-center text-muted-foreground`}
      role="img"
      aria-label={`${alt} (image unavailable)`}
    >
      <ImageIcon className="h-10 w-10 opacity-50" />
    </div>
  );
}
