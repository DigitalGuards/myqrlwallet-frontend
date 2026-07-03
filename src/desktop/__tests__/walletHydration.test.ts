/**
 * Unit tests for the desktop wallet hydration helpers: merging the signer's
 * wallet addresses into the renderer's account list, and choosing an active
 * wallet to adopt. These back the fix for the "signer can unlock a wallet but
 * the renderer shows 0 wallets" divergence.
 */

import { describe, it, expect } from '@jest/globals';
import { mergeSignerWalletsIntoList, pickActiveWallet } from '../walletHydration';
import type { AccountListItem } from '@/utils/storage';

const A = 'Q1111111111111111111111111111111111111111';
const B = 'Q2222222222222222222222222222222222222222';
const C = 'Q3333333333333333333333333333333333333333';

describe('mergeSignerWalletsIntoList', () => {
  it('adds a signer wallet missing from an empty list (the reported bug)', () => {
    const { list, added } = mergeSignerWalletsIntoList([], [A]);
    expect(added).toBe(true);
    expect(list).toEqual([{ address: A, source: 'seed' }]);
  });

  it('reports nothing added when every signer wallet is already known', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'seed' }];
    const { list, added } = mergeSignerWalletsIntoList(stored, [A]);
    expect(added).toBe(false);
    expect(list).toEqual(stored);
  });

  it('preserves existing entries and their source, appending only the new ones', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'extension' }];
    const { list, added } = mergeSignerWalletsIntoList(stored, [A, B]);
    expect(added).toBe(true);
    expect(list).toEqual([
      { address: A, source: 'extension' },
      { address: B, source: 'seed' },
    ]);
  });

  it('matches known addresses case-insensitively (no duplicate)', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'seed' }];
    const { list, added } = mergeSignerWalletsIntoList(stored, [A.toLowerCase()]);
    expect(added).toBe(false);
    expect(list).toHaveLength(1);
  });

  it('dedupes repeats within the signer list', () => {
    const { list, added } = mergeSignerWalletsIntoList([], [B, B, C]);
    expect(added).toBe(true);
    expect(list.map((a) => a.address)).toEqual([B, C]);
  });

  it('skips empty addresses', () => {
    const { list, added } = mergeSignerWalletsIntoList([], ['']);
    expect(added).toBe(false);
    expect(list).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'seed' }];
    mergeSignerWalletsIntoList(stored, [B]);
    expect(stored).toEqual([{ address: A, source: 'seed' }]);
  });

  it('tolerates a malformed stored entry (no throw) and still merges', () => {
    // localStorage is unvalidated: an entry missing address must not blow up
    // the whole reconcile. It is preserved verbatim; the new wallet is added.
    // Built via JSON.parse so the malformed shape is a genuine runtime value
    // (not a compile-time cast the hardened lint bans).
    const stored = JSON.parse(`[{"source":"seed"},{"address":"${A}","source":"seed"}]`) as AccountListItem[];
    const { list, added } = mergeSignerWalletsIntoList(stored, [B]);
    expect(added).toBe(true);
    expect(list).toHaveLength(3);
    expect(list[2]).toEqual({ address: B, source: 'seed' });
  });
});

describe('pickActiveWallet', () => {
  it('prefers the signer active pointer when it is a real wallet', () => {
    expect(pickActiveWallet([A, B], B)).toBe(B);
  });

  it('matches the active pointer case-insensitively', () => {
    expect(pickActiveWallet([A, B], B.toLowerCase())).toBe(B.toLowerCase());
  });

  it('falls back to the first wallet when active is null', () => {
    expect(pickActiveWallet([A, B], null)).toBe(A);
  });

  it('falls back to the first wallet when active is not among the wallets', () => {
    expect(pickActiveWallet([A, B], C)).toBe(A);
  });

  it('returns undefined when there are no wallets', () => {
    expect(pickActiveWallet([], null)).toBeUndefined();
  });
});
