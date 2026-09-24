import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  formatAddressFingerprint,
  splitAddressGroups,
} from "@/utils/formatting/address";
import { copyToClipboard } from "@/utils/nativeApp";

/**
 * Ghost icon-button styling. Kept local so this component stays free of the
 * utils barrel that Button pulls in through the router.
 */
const ICON_BUTTON_CLASS =
  "inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export interface AddressDisclosureProps {
  address: string;
  className?: string;
  fingerprintClassName?: string;
  fullAddressClassName?: string;
}

/**
 * Compact address with explicit reveal and raw-copy actions for narrow
 * surfaces. The visible text is abbreviated or grouped for readability while
 * assistive technology and the clipboard always receive the exact address.
 * This mirrors the browser extension's AddressDisclosure so both wallets
 * present an address the same way.
 */
export function AddressDisclosure({
  address,
  className,
  fingerprintClassName,
  fullAddressClassName,
}: AddressDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const fullAddressId = useId();
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimerRef.current), []);

  const onCopy = async () => {
    const success = await copyToClipboard(address);
    if (!success) {
      setCopied(false);
      return;
    }
    setCopied(true);
    clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const { prefix, groups } = splitAddressGroups(address);
  const groupedAddress = prefix ? `${prefix} ${groups.join(" ")}` : address;

  return (
    <div className={cn("min-w-0 max-w-full", className)}>
      <div className="flex min-w-0 max-w-full items-center justify-center gap-1">
        <span
          className={cn(
            "min-w-0 font-data text-xs break-words [overflow-wrap:anywhere]",
            fingerprintClassName,
          )}
          title={address}
        >
          <span className="sr-only">{address}</span>
          <span aria-hidden="true">{formatAddressFingerprint(address)}</span>
        </span>
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          aria-label={copied ? "Address copied" : "Copy address"}
          title={copied ? "Address copied" : "Copy address"}
          onClick={() => void onCopy()}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          aria-controls={fullAddressId}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide full address" : "Show full address"}
          title={expanded ? "Hide full address" : "Show full address"}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? "Address copied to clipboard" : ""}
      </span>
      {expanded && (
        <div
          id={fullAddressId}
          data-testid="address-disclosure-full"
          className="mt-2 min-w-0 max-w-full rounded-md border border-border bg-background/50 p-2"
        >
          <span
            className={cn(
              "inline-block min-w-0 max-w-full font-data text-xs leading-relaxed break-words [overflow-wrap:anywhere]",
              fullAddressClassName,
            )}
            title={address}
          >
            <span className="sr-only">{address}</span>
            <span aria-hidden="true">{groupedAddress}</span>
          </span>
        </div>
      )}
    </div>
  );
}

export default AddressDisclosure;
