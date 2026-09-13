/** @jest-environment jsdom */

jest.mock("../nativeApp", () => ({
  isInNativeApp: jest.fn(() => false),
  notifyContactsUpdated: jest.fn(),
}));

import {
  addEntry,
  clearAddressBook,
  loadAddressBook,
  mergeContacts,
} from "../addressBook";

const STORAGE_KEY = "qrl:addressBook:qip55:v2";
const LEGACY_STORAGE_KEY = "qrl:addressBook:v1";
const LOWER =
  "Qd5812f6cf4a0f645aa620cd57319a0ed649dd8f5519a9dde7770ae5b0e49e547985f35eb972a2a07041561aa39c65a3991478f9b1e6749e05277dcf58a9a8b72";
const CANONICAL =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";
const LEGACY_Q40 = `Q${"12".repeat(20)}`;

describe("QIP-55 address-book persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("canonicalizes a valid Q+128 address before writing it", () => {
    const result = addEntry("Primary", LOWER);

    expect(result).toEqual(expect.objectContaining({ address: CANONICAL }));
    expect(loadAddressBook()).toEqual([
      expect.objectContaining({ name: "Primary", address: CANONICAL }),
    ]);
    expect(localStorage.getItem(STORAGE_KEY)).toContain(CANONICAL);
  });

  it("rejects Q+40 contacts", () => {
    expect(addEntry("Legacy", LEGACY_Q40)).toBe(
      "Not a valid QIP-55 address (Q + 128 hex characters)",
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("filters legacy rows at read time without rewriting recoverable raw data", () => {
    const raw = JSON.stringify([
      { id: "legacy", name: "Legacy", address: LEGACY_Q40, createdAt: 1 },
      { id: "current", name: "Current", address: LOWER, createdAt: 2 },
    ]);
    localStorage.setItem(STORAGE_KEY, raw);

    expect(loadAddressBook()).toEqual([
      { id: "current", name: "Current", address: CANONICAL, createdAt: 2 },
    ]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it("isolates the old address-book namespace for rollback", () => {
    const legacyRaw = JSON.stringify([
      { id: "legacy", name: "Legacy", address: LEGACY_Q40, createdAt: 1 },
    ]);
    localStorage.setItem(LEGACY_STORAGE_KEY, legacyRaw);

    expect(loadAddressBook()).toEqual([]);
    expect(addEntry("Current", LOWER)).toEqual(
      expect.objectContaining({ address: CANONICAL }),
    );
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(legacyRaw);
  });

  it("removes both namespaces during an explicit full wipe", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, "legacy");
    localStorage.setItem(STORAGE_KEY, "current");

    clearAddressBook();

    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("canonicalizes and deduplicates native contact restores", () => {
    mergeContacts([
      { id: "first", name: "First", address: LOWER, createdAt: 1 },
      { id: "duplicate", name: "Duplicate", address: CANONICAL, createdAt: 2 },
      { id: "legacy", name: "Legacy", address: LEGACY_Q40, createdAt: 3 },
    ]);

    expect(loadAddressBook()).toEqual([
      { id: "first", name: "First", address: CANONICAL, createdAt: 1 },
    ]);
  });
});
