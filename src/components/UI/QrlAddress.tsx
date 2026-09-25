import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/utils/cn";
import {
  formatAddress,
  formatAddressEnds,
  formatAddressFingerprint,
} from "@/utils/formatting/address";
import { copyToClipboard } from "@/utils/nativeApp";

export interface QrlAddressProps {
  address: string;
  mode?: "compact" | "full";
  compactFormat?: "fingerprint" | "short";
  revealable?: boolean;
  onShowFull?: () => void;
  copyable?: boolean;
  className?: string;
  addressClassName?: string;
  copyLabel?: string;
  /** Renders the address itself as an external link, e.g. to a block explorer. */
  href?: string;
  /**
   * Purpose appended to the link's accessible name. It describes where the
   * link goes; the address stays part of the name.
   */
  linkLabel?: string;
}

export function QrlAddress({
  address,
  mode = "compact",
  compactFormat = "fingerprint",
  revealable = false,
  onShowFull,
  copyable = false,
  className,
  addressClassName,
  copyLabel = "Copy address",
  href,
  linkLabel,
}: QrlAddressProps) {
  const [revealedAddress, setRevealedAddress] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const isRevealed =
    !onShowFull && mode === "compact" && revealedAddress === address;
  const isFull = mode === "full" || isRevealed;
  const addressGroups = isFull ? formatAddress(address).split(" ") : [];

  const handleCopy = async () => {
    if (await copyToClipboard(address)) {
      setCopiedAddress(address);
    }
  };

  const addressText = (
    <span
      className={cn(
        "min-w-0 max-w-full font-data",
        // The 16 groups of 8 characters sit in 2, 4 or 8 columns, chosen by
        // the width of the surrounding card (a container query on the
        // wrapper below), so every row is full and groups never overlap.
        isRevealed
          ? "grid w-full grid-cols-2 gap-x-3 gap-y-1 text-left @sm:grid-cols-4 @2xl:grid-cols-8"
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
              className="inline-block min-w-0 max-w-full [overflow-wrap:anywhere]"
            >
              {group}
            </span>
          ))
        : compactFormat === "short"
          ? formatAddressEnds(address)
          : formatAddressFingerprint(address)}
    </span>
  );

  return (
    <span
      className={cn(
        "min-w-0 max-w-full",
        isRevealed
          ? "@container flex w-full flex-col items-stretch gap-2"
          : "inline-flex flex-wrap items-center gap-x-2 gap-y-1",
        className,
      )}
      data-address-mode={isFull ? "full" : "compact"}
      data-address-revealed={isRevealed ? "true" : "false"}
    >
      {href ? (
        <a
          className="inline-flex min-w-0 max-w-full items-center gap-1 text-identity-accent underline"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={address}
        >
          {addressText}
          {/*
            The link keeps its name from its contents, so the address stays
            part of it. The purpose is appended for assistive technology
            instead of replacing the address with an aria-label.
          */}
          <span className="sr-only">{linkLabel ?? "opens in a new tab"}</span>
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
        </a>
      ) : (
        addressText
      )}
      {revealable || onShowFull || copyable ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-2",
            isRevealed && "justify-end",
          )}
        >
          {(revealable || onShowFull) && mode === "compact" ? (
            <button
              type="button"
              className="shrink-0 rounded-sm text-xs font-medium text-secondary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-expanded={onShowFull ? undefined : isFull}
              onClick={(event) => {
                event.stopPropagation();
                if (onShowFull) onShowFull();
                else setRevealedAddress(isFull ? null : address);
              }}
            >
              {isFull ? "Show less" : "Show full"}
            </button>
          ) : null}
          {copyable ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={
                copiedAddress === address ? "Address copied" : copyLabel
              }
              onClick={(event) => {
                event.stopPropagation();
                void handleCopy();
              }}
            >
              {copiedAddress === address ? (
                <Check
                  className="h-3.5 w-3.5 text-success"
                  aria-hidden="true"
                />
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
