/**
 * Address book: named QRL address contacts persisted in localStorage.
 *
 * Plain data (names + public Q-addresses), so it deliberately lives outside
 * StorageUtil's expiring-item envelope: contacts must never silently expire.
 */

export interface AddressBookEntry {
  id: string;
  name: string;
  address: string;
  createdAt: number;
}

const STORAGE_KEY = "qrl:addressBook:v1";

export const isValidQrlAddress = (address: string): boolean => {
  const trimmed = address.trim();
  return trimmed.startsWith("Q") && trimmed.length === 41;
};

const isEntry = (value: unknown): value is AddressBookEntry => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["name"] === "string" &&
    typeof v["address"] === "string" &&
    typeof v["createdAt"] === "number"
  );
};

export function loadAddressBook(): AddressBookEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function persist(entries: AddressBookEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function findByAddress(address: string): AddressBookEntry | undefined {
  const needle = address.trim().toLowerCase();
  return loadAddressBook().find((e) => e.address.toLowerCase() === needle);
}

/** Add a contact. Returns the new entry, or an error message string. */
export function addEntry(name: string, address: string): AddressBookEntry | string {
  const cleanName = name.trim();
  const cleanAddress = address.trim();
  if (!cleanName) return "Name is required";
  if (!isValidQrlAddress(cleanAddress)) return "Not a valid QRL address (Q + 40 characters)";
  if (findByAddress(cleanAddress)) return "This address is already saved";
  const entry: AddressBookEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanName,
    address: cleanAddress,
    createdAt: Date.now(),
  };
  persist([...loadAddressBook(), entry]);
  return entry;
}

/** Rename a contact. Returns true when an entry was updated. */
export function renameEntry(id: string, name: string): boolean {
  const cleanName = name.trim();
  if (!cleanName) return false;
  const entries = loadAddressBook();
  const target = entries.find((e) => e.id === id);
  if (!target) return false;
  target.name = cleanName;
  persist(entries);
  return true;
}

/** Delete a contact. Returns true when an entry was removed. */
export function removeEntry(id: string): boolean {
  const entries = loadAddressBook();
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return false;
  persist(next);
  return true;
}
