import { Check, Loader2, TriangleAlert } from "lucide-react";
import type { QrnsRecipientState } from "@/hooks/useQrnsRecipient";
import { QrlAddress } from "@/components/UI/QrlAddress";

interface RecipientResolutionStatusProps {
  resolution: QrnsRecipientState;
}

/** Show the exact concrete QIP-55 address that will be submitted. */
export function RecipientResolutionStatus({
  resolution,
}: RecipientResolutionStatusProps) {
  if (resolution.status === "idle") return null;

  if (resolution.status === "pending") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        <span>{resolution.message}</span>
      </div>
    );
  }

  if (resolution.status === "success" && resolution.address) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mt-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm"
      >
        <div className="flex items-center gap-2 font-medium text-success">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{resolution.message}</span>
        </div>
        <QrlAddress
          address={resolution.address}
          mode="full"
          className="mt-1 w-full"
          addressClassName="text-xs text-foreground"
        />
      </div>
    );
  }

  const unavailable = resolution.status === "unavailable";
  return (
    <div
      role={unavailable ? "status" : "alert"}
      aria-live={unavailable ? "polite" : "assertive"}
      className={
        unavailable
          ? "mt-2 flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground"
          : "mt-2 flex items-start gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive"
      }
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{resolution.message}</span>
    </div>
  );
}
