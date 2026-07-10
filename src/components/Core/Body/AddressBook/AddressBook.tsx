import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookUser, Copy, Pencil, Plus, Send, Trash2, Check } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
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
import { addEntry, loadAddressBook, removeEntry, renameEntry } from "@/utils/addressBook";

export default function AddressBook() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<AddressBookEntry[]>(() => loadAddressBook());
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AddressBookEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AddressBookEntry | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = () => setEntries(loadAddressBook());

  const handleAdd = () => {
    const result = addEntry(newName, newAddress);
    if (typeof result === "string") {
      setAddError(result);
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
    copyToClipboard(entry.address);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId((current) => (current === entry.id ? null : current)), 1500);
  };

  const handleSend = (entry: AddressBookEntry) => {
    navigate(ROUTES.TRANSFER, { state: { receiverAddress: entry.address } });
  };

  return (
    <div className="flex flex-col gap-4 p-4 pb-20 max-w-2xl mx-auto w-full">
      <Card className="border-l-4 border-l-orange-500">
        <CardHeader className="bg-gradient-to-r from-orange-500/5 to-transparent">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <BookUser className="h-7 w-7 text-secondary" />
              <div>
                <CardTitle className="text-2xl font-bold">Address Book</CardTitle>
                <CardDescription>Saved recipients for quick transfers</CardDescription>
              </div>
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {entries.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 flex flex-col items-center gap-3">
              <BookUser className="h-10 w-10 opacity-40" />
              <p>No saved addresses yet.</p>
              <p className="text-sm">
                Add one here, or save a recipient from the Transfer page.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{entry.name}</p>
                    <p className="text-sm text-muted-foreground font-mono truncate">
                      {formatAddressShort(entry.address)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Copy address"
                      onClick={() => handleCopy(entry)}
                    >
                      {copiedId === entry.id ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Send to this address"
                      onClick={() => handleSend(entry)}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Rename"
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
                      title="Delete"
                      onClick={() => setDeleteTarget(entry)}
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
            <DialogTitle>Add Address</DialogTitle>
            <DialogDescription>Save a recipient for quick transfers.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-name">Name</Label>
              <Input
                id="ab-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Cold storage"
                maxLength={40}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ab-address">QRL address</Label>
              <Input
                id="ab-address"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="Q..."
                className="font-mono"
              />
            </div>
            {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename contact */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Address</DialogTitle>
            <DialogDescription className="font-mono">
              {renameTarget ? formatAddressShort(renameTarget.address) : ""}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={40}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete contact */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Address?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `"${deleteTarget.name}" (${formatAddressShort(deleteTarget.address)}) will be removed from your address book.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
