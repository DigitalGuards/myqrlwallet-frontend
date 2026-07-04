/**
 * Unit tests for the desktop wallet hydration helpers: reconciling the
 * renderer's account list against the signer's wallets (add missing, drop
 * removed), and choosing an active wallet to adopt. These back two fixes:
 * "signer can unlock a wallet but the renderer shows 0 wallets", and the
 * ghost account left behind when a wallet is removed from the native
 * settings window (the renderer is reloaded and this reconcile erases it).
 */

import { describe, it, expect } from '@jest/globals';
import { isAddressListed, pickActiveWallet, reconcileSignerWallets } from '../walletHydration';
import type { AccountListItem } from '@/utils/storage';

const A = 'Q1111111111111111111111111111111111111111';
const B = 'Q2222222222222222222222222222222222222222';
const C = 'Q3333333333333333333333333333333333333333';

describe('reconcileSignerWallets', () => {
  it('adds a signer wallet missing from an empty list (the reported bug)', () => {
    const { list, changed } = reconcileSignerWallets([], [A], true);
    expect(changed).toBe(true);
    expect(list).toEqual([{ address: A, source: 'seed' }]);
  });

  it('reports no change when the list already mirrors the signer', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'seed' }];
    const { list, changed } = reconcileSignerWallets(stored, [A], true);
    expect(changed).toBe(false);
    expect(list).toEqual(stored);
  });


  it('with removeMissing=false (non-authoritative source) it is add-only, never drops', () => {
    const stored: AccountListItem[] = [
      { address: A, source: 'seed' },
      { address: B, source: 'seed' },
    ];
    // The getStatus fallback reports at most one address: nothing may be
    // erased off that partial view.
    const { list, changed } = reconcileSignerWallets(stored, [A], false);
    expect(changed).toBe(false);
    expect(list).toEqual(stored);
    const added = reconcileSignerWallets(stored, [C], false);
    expect(added.changed).toBe(true);
    expect(added.list).toEqual([...stored, { address: C, source: 'seed' }]);
  });

  it('drops a seed entry whose wallet the signer no longer has (native removal)', () => {
    const stored: AccountListItem[] = [
      { address: A, source: 'seed' },
      { address: B, source: 'seed' },
    ];
    const { list, changed } = reconcileSignerWallets(stored, [A], true);
    expect(changed).toBe(true);
    expect(list).toEqual([{ address: A, source: 'seed' }]);
  });

  it('reconciles to empty when the signer has no wallets left (last wallet removed)', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'seed' }];
    const { list, changed } = reconcileSignerWallets(stored, [], true);
    expect(changed).toBe(true);
    expect(list).toEqual([]);
  });

  it('preserves extension entries (not owned by the signer)', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'extension' }];
    const { list, changed } = reconcileSignerWallets(stored, [B], true);
    expect(changed).toBe(true);
    expect(list).toEqual([
      { address: A, source: 'extension' },
      { address: B, source: 'seed' },
    ]);
  });

  it('does not duplicate an extension entry whose address the signer also has', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'extension' }];
    const { list, changed } = reconcileSignerWallets(stored, [A], true);
    expect(changed).toBe(false);
    expect(list).toEqual(stored);
  });

  it('matches known addresses case-insensitively (no duplicate, no drop)', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'seed' }];
    const { list, changed } = reconcileSignerWallets(stored, [A.toLowerCase()], true);
    expect(changed).toBe(false);
    expect(list).toHaveLength(1);
  });

  it('dedupes repeats within the signer list', () => {
    const { list, changed } = reconcileSignerWallets([], [B, B, C], true);
    expect(changed).toBe(true);
    expect(list.map((a) => a.address)).toEqual([B, C]);
  });

  it('skips empty addresses', () => {
    const { list, changed } = reconcileSignerWallets([], [''], true);
    expect(changed).toBe(false);
    expect(list).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const stored: AccountListItem[] = [{ address: A, source: 'seed' }];
    reconcileSignerWallets(stored, [B], true);
    expect(stored).toEqual([{ address: A, source: 'seed' }]);
  });

  it('tolerates a malformed stored entry (no throw), preserving it verbatim', () => {
    // localStorage is unvalidated: an entry missing address must not blow up
    // the whole reconcile, and must not be dropped (it cannot be matched).
    // Built via JSON.parse so the malformed shape is a genuine runtime value
    // (not a compile-time cast the hardened lint bans).
    const stored = JSON.parse(
      `[{"source":"seed"},{"address":"${A}","source":"seed"}]`,
    ) as AccountListItem[];
    const { list, changed } = reconcileSignerWallets(stored, [A, B], true);
    expect(changed).toBe(true);
    expect(list).toHaveLength(3);
    expect(list[2]).toEqual({ address: B, source: 'seed' });
  });
});

describe('isAddressListed', () => {
  it('finds an address case-insensitively', () => {
    const list: AccountListItem[] = [{ address: A, source: 'seed' }];
    expect(isAddressListed(list, A.toLowerCase())).toBe(true);
  });

  it('returns false for a removed address and tolerates malformed entries', () => {
    const list = JSON.parse(`[{"source":"seed"},{"address":"${A}","source":"seed"}]`) as AccountListItem[];
    expect(isAddressListed(list, B)).toBe(false);
    expect(isAddressListed(list, A)).toBe(true);
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
