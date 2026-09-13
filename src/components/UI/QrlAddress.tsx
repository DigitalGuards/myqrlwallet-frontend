import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  formatAddress,
  formatAddressFingerprint,
} from "@/utils/formatting/address";
import { copyToClipboard } from "@/utils/nativeApp";

export interface QrlAddressProps {
  address: string;
  mode?: "compact" | "full";
  revealable?: boolean;
  copyable?: boolean;
  className?: string;
  addressClassName?: string;
  copyLabel?: string;
}

export function QrlAddress({
  address,
  mode = "compact",
  revealable = false,
  copyable = false,
  className,
  addressClassName,
  copyLabel = "Copy address",
}: QrlAddressProps) {
  const [revealedAddress, setRevealedAddress] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const isRevealed = mode === "compact" && revealedAddress === address;
  const isFull = mode === "full" || isRevealed;
  const addressGroups = isFull ? formatAddress(address).split(" ") : [];

  const handleCopy = async () => {
    if (await copyToClipboard(address)) {
      setCopiedAddress(address);
    }
  };

  return (
    <span
      className={cn(
        "min-w-0 max-w-full",
        isRevealed
          ? "flex w-full flex-col items-stretch gap-2"
          : "inline-flex flex-wrap items-center gap-x-2 gap-y-1",
        className,
      )}
      data-address-mode={isFull ? "full" : "compact"}
      data-address-revealed={isRevealed ? "true" : "false"}
    >
      <span
        className={cn(
          "min-w-0 max-w-full font-data",
          isRevealed
            ? "grid w-full grid-cols-2 gap-x-3 gap-y-1 text-left sm:grid-cols-4 md:grid-cols-8"
            : isFull
            ? "inline-flex flex-wrap gap-x-2 gap-y-0.5 whitespace-normal break-words [overflow-wrap:anywhere]"
            : "whitespace-nowrap",
          addressClassName,
        )}
        aria-label={`QRL address ${address}`}
        dir="ltr"
      >
        {isFull
          ? addressGroups.map((group, index) => (
              <span
                key={`${index}-${group}`}
                className="inline-block min-w-0 max-w-full"
              >
                {group}
              </span>
            ))
          : formatAddressFingerprint(address)}
      </span>
      {revealable || copyable ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-2",
            isRevealed && "justify-end",
          )}
        >
          {revealable && mode === "compact" ? (
            <button
              type="button"
              className="shrink-0 rounded-sm text-xs font-medium text-secondary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-expanded={isFull}
              onClick={(event) => {
                event.stopPropagation();
                setRevealedAddress(isFull ? null : address);
              }}
            >
              {isFull ? "Show less" : "Show full"}
            </button>
          ) : null}
          {copyable ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={copiedAddress === address ? "Address copied" : copyLabel}
              onClick={(event) => {
                event.stopPropagation();
                void handleCopy();
              }}
            >
              {copiedAddress === address ? (
                <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span aria-live="polite">
                {copiedAddress === address ? "Copied" : "Copy"}
              </span>
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
