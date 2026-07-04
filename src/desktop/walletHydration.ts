/**
 * Desktop wallet hydration helpers.
 *
 * On desktop the SIGNER (its encrypted seed files on disk) is the source of
 * truth for which wallets exist, not the renderer's localStorage account list.
 * The renderer never holds seeds, and every import/create flow routes through
 * the signer, so any divergence (localStorage cleared, a wallet provisioned in
 * another session, a wallet REMOVED from the native settings window) is
 * resolved by reconciling the account list against the signer on startup and
 * on unlock:
 *
 *   - signer wallets missing from the list are appended (as 'seed' accounts)
 *   - 'seed' entries whose wallet no longer exists in the signer are dropped
 *     (this is how a native-window removal reaches the renderer: main reloads
 *     it and this reconcile erases the ghost account)
 *   - 'extension' entries and malformed entries are preserved verbatim:
 *     they are not the signer's to own
 *
 * This module holds only the pure reconcile so it is trivially unit-testable;
 * the bridge calls and storage writes live in qrlStore.
 */

import type { AccountListItem } from '@/utils/storage';

/**
 * Reconcile the renderer's stored account list against the signer's wallet
 * addresses (see module doc for the rules). Address comparison is
 * case-insensitive. Returns the new list and whether it differs from the
 * stored one, so the caller can skip the storage write when nothing changed.
 *
 * `removeMissing` gates the destructive half: pass true ONLY when the signer
 * address list is authoritative (a successful listWallets disk read). With
 * false the reconcile is add-only, so a degraded source (the single-address
 * getStatus fallback) can never drop wallets it simply did not report.
 */
export function reconcileSignerWallets(
  stored: AccountListItem[],
  signerAddresses: string[],
  removeMissing: boolean,
): { list: AccountListItem[]; changed: boolean } {
  const signerKeys = new Set(
    signerAddresses.filter((a) => Boolean(a)).map((a) => a.toLowerCase()),
  );

  // Drop 'seed' entries the signer no longer knows. stored comes from
  // localStorage unvalidated; tolerate a malformed entry (missing/non-string
  // address) rather than throwing out the whole reconcile. Such entries are
  // preserved verbatim, just not matched against.
  const list = stored.filter((entry) => {
    if (!removeMissing) return true;
    if (typeof entry?.address !== 'string') return true;
    if (entry.source !== 'seed') return true;
    return signerKeys.has(entry.address.toLowerCase());
  });
  let changed = list.length !== stored.length;

  // Append signer wallets the list does not yet know.
  const known = new Set(
    list
      .map((a) => (typeof a?.address === 'string' ? a.address.toLowerCase() : null))
      .filter((k): k is string => k !== null),
  );
  for (const address of signerAddresses) {
    if (!address) continue;
    const key = address.toLowerCase();
    if (!known.has(key)) {
      list.push({ address, source: 'seed' });
      known.add(key);
      changed = true;
    }
  }
  return { list, changed };
}

/**
 * True when `address` appears in the reconciled list (case-insensitive,
 * malformed-entry tolerant). Used to detect a stored active account whose
 * wallet was removed.
 */
export function isAddressListed(list: AccountListItem[], address: string): boolean {
  const key = address.toLowerCase();
  return list.some((a) => typeof a?.address === 'string' && a.address.toLowerCase() === key);
}

/**
 * Pick which wallet to adopt as active when the renderer has none stored (or
 * its stored one was removed): prefer the signer's own active pointer when it
 * is a real wallet, else the first signer wallet. Returns undefined when there
 * is nothing to adopt.
 */
export function pickActiveWallet(
  signerAddresses: string[],
  signerActive: string | null | undefined,
): string | undefined {
  if (
    signerActive &&
    signerAddresses.some((a) => a.toLowerCase() === signerActive.toLowerCase())
  ) {
    return signerActive;
  }
  return signerAddresses[0];
}

/** Canonical-case an address as it appears in the reconciled list (so a strict
 * equality lookup elsewhere matches); returns the input if not listed.
 * Malformed-entry tolerant. */
function canonicalOf(list: AccountListItem[], addr: string): string {
  const key = addr.toLowerCase();
  return (
    list.find((a) => typeof a?.address === 'string' && a.address.toLowerCase() === key)?.address ??
    addr
  );
}

/** What the renderer should do with its active-account pointer after a
 * reconcile. `set` adopts `address`; `clear` wipes it; `none` leaves it. */
export type ActiveAccountDecision =
  | { action: 'set'; address: string }
  | { action: 'clear' }
  | { action: 'none' };

/**
 * Decide the renderer's active account after hydrating against the signer.
 *
 * On desktop the signer's active pointer IS the account that is unlocked
 * (every unlock and setActiveWallet calls setActiveAddress) and the ONLY
 * account that can sign. The renderer active account MUST mirror it, or a send
 * builds `from` from a stale renderer active that differs from the unlocked
 * session and the signer rejects it ("signing account mismatch"). So:
 *
 *  1. If the signer's active pointer names a real listed wallet and the
 *     renderer differs, adopt it (the load-bearing sync).
 *  2. Else, when the renderer has no active or its stored one is no longer
 *     listed (authoritative removals only), adopt any wallet, or clear if the
 *     last wallet is gone.
 *  3. Else leave the renderer active as-is.
 */
export function decideActiveAccount(params: {
  list: AccountListItem[];
  storedActive: string | null | undefined;
  signerActive: string | null | undefined;
  signerAddresses: string[];
  /** True only when signerAddresses came from an authoritative listWallets. */
  authoritative: boolean;
}): ActiveAccountDecision {
  const { list, storedActive, signerActive, signerAddresses, authoritative } = params;
  const storedKey = (storedActive ?? '').toLowerCase();

  if (signerActive && isAddressListed(list, signerActive)) {
    const canonical = canonicalOf(list, signerActive);
    if (canonical.toLowerCase() !== storedKey) return { action: 'set', address: canonical };
    return { action: 'none' };
  }

  if (!storedActive || (authoritative && !isAddressListed(list, storedActive))) {
    const adopt = pickActiveWallet(signerAddresses, signerActive);
    if (adopt) return { action: 'set', address: canonicalOf(list, adopt) };
    if (storedActive) return { action: 'clear' };
  }
  return { action: 'none' };
}
