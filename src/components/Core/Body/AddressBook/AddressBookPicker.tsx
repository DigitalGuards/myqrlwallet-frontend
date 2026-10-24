import { contactErrorKey } from "@/i18n/contactErrorKey";
import { useTranslation } from "react-i18next";
import { logger } from "@/utils/log";
import { useState } from "react";
import { useNavigate } from "react-router";
import { BookUser, Plus } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import { ROUTES } from "@/router/router";
import { formatAddressShort } from "@/utils/formatting";
import { addEntry, isValidQrlAddress, loadAddressBook } from "@/utils/addressBook";
import { QrlAddress } from "@/components/UI/QrlAddress";

interface AddressBookPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the picked address; the picker closes itself. */
  onSelect: (address: string) => void;
  /**
   * The address currently typed in the form. When valid and not yet saved,
   * the picker offers to save it under a name.
   */
  currentAddress?: string;
}

export function AddressBookPicker({
  open,
  onOpenChange,
  onSelect,
  currentAddress,
}: AddressBookPickerProps) {
  const { t } = useTranslation(["contacts", "common"]);
  const navigate = useNavigate();
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<ReturnType<typeof contactErrorKey> | null>(null);

  // The list is tiny; reading it during render keeps it fresh on every
  // open and after an in-dialog save without effect/refresh plumbing.
  const entries = open ? loadAddressBook() : [];

  // Radix fires onOpenChange on close; resetting there makes each open fresh.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSaveName("");
      setSaveError(null);
    }
    onOpenChange(next);
  };

  const trimmedCurrent = (currentAddress ?? "").trim();
  // Gated on open and derived from the in-memory list so a closed picker
  // costs the parent's renders nothing (PR #227 review feedback).
  const offerSave =
    open &&
    isValidQrlAddress(trimmedCurrent) &&
    !entries.some((e) => e.address.toLowerCase() === trimmedCurrent.toLowerCase());

  const handleSaveCurrent = () => {
    const result = addEntry(saveName, trimmedCurrent);
    if (typeof result === "string") {
      setSaveError(contactErrorKey(result));
      return;
    }
    setSaveName("");
    setSaveError(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookUser className="h-5 w-5 text-secondary" />
            {t("contacts:title")}
          </DialogTitle>
          <DialogDescription>{t("contacts:pick")}</DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("contacts:empty")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border -mx-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="w-full text-left px-2 py-3 hover:bg-accent rounded-md transition-colors"
                  onClick={() => {
                    onSelect(entry.address);
                    onOpenChange(false);
                  }}
                >
                  <p className="font-semibold truncate">{entry.name}</p>
                  <QrlAddress
                    address={entry.address}
                    className="text-sm text-muted-foreground"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}

        {offerSave ? (
          <div className="border-t border-border pt-3 flex flex-col gap-2">
            <Label htmlFor="ab-save-name">
              {t("contacts:saveAs", { address: formatAddressShort(trimmedCurrent) })}
            </Label>
            <div className="flex gap-2">
              <Input
                id="ab-save-name"
                value={saveName}
                onChange={(e) => {
                  setSaveName(e.target.value);
                }}
                placeholder={t("contacts:name")}
                maxLength={40}
              />
              <Button onClick={handleSaveCurrent} disabled={!saveName.trim()}>
                <Plus className="h-4 w-4 mr-1" />
                {t("contacts:save")}
              </Button>
            </div>
            {saveError ? <p className="text-sm text-destructive">{t(saveError.key, { reason: saveError.reason })}</p> : null}
          </div>
        ) : null}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            onOpenChange(false);
            Promise.resolve(navigate(ROUTES.ADDRESS_BOOK)).catch((error: unknown) => {
              logger.error("Failed to open address book:", error);
            });
          }}
        >
          {t("contacts:manage")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
