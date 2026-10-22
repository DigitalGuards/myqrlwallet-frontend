import { contactErrorKey } from "@/i18n/contactErrorKey";
import { useTranslation } from "react-i18next";
import { logger } from "@/utils/log";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  BookUser,
  Copy,
  Pencil,
  Plus,
  Send,
  Trash2,
  Check,
} from "lucide-react";
import { Button } from "@/components/UI/Button";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { Card, CardContent } from "@/components/UI/Card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import { ROUTES } from "@/router/router";
import { copyToClipboard } from "@/utils/nativeApp";
import { formatAddressShort } from "@/utils/formatting";
import type { AddressBookEntry } from "@/utils/addressBook";
import {
  addEntry,
  loadAddressBook,
  removeEntry,
  renameEntry,
} from "@/utils/addressBook";
import { QrlAddress } from "@/components/UI/QrlAddress";

export default function AddressBook() {
  const { t } = useTranslation(["contacts", "common"]);
  const navigate = useNavigate();
  const [entries, setEntries] = useState<AddressBookEntry[]>(() =>
    loadAddressBook(),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addError, setAddError] = useState<ReturnType<typeof contactErrorKey> | null>(null);
  const [renameTarget, setRenameTarget] = useState<AddressBookEntry | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AddressBookEntry | null>(
    null,
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = () => {
    setEntries(loadAddressBook());
  };

  const handleAdd = () => {
    const result = addEntry(newName, newAddress);
    if (typeof result === "string") {
      setAddError(contactErrorKey(result));
      return;
    }
    setAddOpen(false);
    setNewName("");
    setNewAddress("");
    setAddError(null);
    refresh();
  };

  const handleRename = () => {
    if (renameTarget && renameEntry(renameTarget.id, renameValue)) {
      setRenameTarget(null);
      refresh();
    }
  };

  const handleDelete = () => {
    if (deleteTarget) {
      removeEntry(deleteTarget.id);
      setDeleteTarget(null);
      refresh();
    }
  };

  const handleCopy = (entry: AddressBookEntry) => {
    copyToClipboard(entry.address).catch((error: unknown) => {
      logger.error("Failed to copy address:", error);
    });
    setCopiedId(entry.id);
    setTimeout(
      () => { setCopiedId((current) => (current === entry.id ? null : current)); },
      1500,
    );
  };

  const handleSend = (entry: AddressBookEntry) => {
    Promise.resolve(navigate(ROUTES.TRANSFER, { state: { receiverAddress: entry.address } })).catch((error: unknown) => {
      logger.error("Failed to open transfer:", error);
    });
  };

  return (
    <PageShell
      title={t("contacts:title")}
      subtitle={t("contacts:subtitle")}
      seoTitle={t("contacts:title")}
      action={
        <Button
          size="sm"
          onClick={() => {
            setAddOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t("contacts:add")}
        </Button>
      }
    >
      <Card>
        <CardContent className="pt-6">
          {entries.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 flex flex-col items-center gap-3">
              <BookUser className="h-10 w-10 opacity-40" />
              <p>{t("contacts:empty")}</p>
              <p className="text-sm">
                {t("contacts:emptyHint")}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 sm:flex-1">
                    <p className="font-semibold truncate">{entry.name}</p>
                    <QrlAddress
                      address={entry.address}
                      revealable
                      className="text-sm text-muted-foreground"
                    />
                  </div>
                  {/* Below the address on phones: the fingerprint and four
                      icon buttons do not fit on one row there. */}
                  <div className="-ml-2 flex items-center gap-1 sm:ml-0 sm:shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("common:copyAddress")}
                      onClick={() => {
                        handleCopy(entry);
                      }}
                    >
                      {copiedId === entry.id ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("contacts:sendTo")}
                      onClick={() => {
                        handleSend(entry);
                      }}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("contacts:rename")}
                      onClick={() => {
                        setRenameTarget(entry);
                        setRenameValue(entry.name);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("contacts:delete")}
                      onClick={() => {
                        setDeleteTarget(entry);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Add contact */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setAddError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("contacts:addTitle")}</DialogTitle>
            <DialogDescription>
              {t("contacts:addDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-name">{t("contacts:name")}</Label>
              <Input
                id="ab-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                }}
                placeholder={t("contacts:namePlaceholder")}
                maxLength={40}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-address">{t("contacts:address")}</Label>
              <Input
                id="ab-address"
                value={newAddress}
                onChange={(e) => {
                  setNewAddress(e.target.value);
                }}
                placeholder={t("contacts:addressPlaceholder")}
                className="font-mono"
              />
            </div>
            {addError ? (
              <p className="text-sm text-destructive">{t(addError.key, { reason: addError.reason })}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddOpen(false);
              }}
            >
              {t("common:cancel")}
            </Button>
            <Button onClick={handleAdd}>{t("contacts:save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename contact */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("contacts:renameTitle")}</DialogTitle>
            <DialogDescription className="font-mono">
              {renameTarget ? formatAddressShort(renameTarget.address) : ""}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => {
              setRenameValue(e.target.value);
            }}
            maxLength={40}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameTarget(null);
              }}
            >
              {t("common:cancel")}
            </Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>
              {t("contacts:save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete contact */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("contacts:deleteTitle")}</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? t("contacts:deleteDescription", { name: deleteTarget.name, address: formatAddressShort(deleteTarget.address) })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
              }}
            >
              {t("common:cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("contacts:delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
