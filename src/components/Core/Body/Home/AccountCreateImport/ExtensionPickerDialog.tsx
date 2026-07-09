import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import type { EIP6963ProviderDetail } from "@/utils/extension";

interface Props {
  providers: EIP6963ProviderDetail[];
  onSelect: (detail: EIP6963ProviderDetail) => void;
  onClose: () => void;
}

/**
 * Shown when more than one QRL wallet extension announced itself via
 * EIP-6963 (e.g. the MyQRLWallet Extension and the upstream QRL Web3 Wallet
 * are both installed). Announcement metadata is page-injectable, so rows
 * render it as text/attributes only, never as HTML.
 */
const ExtensionPickerDialog = ({ providers, onSelect, onClose }: Props) => (
  <Dialog
    open
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
  >
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Choose a wallet extension</DialogTitle>
        <DialogDescription>
          More than one QRL wallet extension is installed. Pick the one to connect.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        {providers.map((detail) => (
          <button
            key={detail.info.rdns}
            type="button"
            onClick={() => onSelect(detail)}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-secondary"
          >
            <img src={detail.info.icon} alt="" className="h-7 w-7 rounded" />
            <span className="flex-1 font-medium">{detail.info.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{detail.info.rdns}</span>
          </button>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);

export default ExtensionPickerDialog;
