/**
 * Desktop wallet hydration helpers.
 *
 * On desktop the SIGNER (its encrypted seed files on disk) is the source of
 * truth for which wallets exist, not the renderer's localStorage account list.
 * The list is only written during the in-renderer import/create flow, so any
 * divergence (localStorage cleared, a wallet provisioned in another session,
 * a per-network list mismatch) leaves the renderer showing "0 wallets" even
 * though the signer can unlock one. qrlStore reconciles by merging the
 * signer's wallet addresses into the account list on startup and on unlock.
 *
 * This module holds only the pure merge so it is trivially unit-testable; the
 * bridge calls and storage writes live in qrlStore.
 */

import type { AccountListItem } from '@/utils/storage';

/**
 * Merge the signer's wallet addresses into the renderer's stored account list,
 * preserving existing entries (and their source) and appending any signer
 * wallet the list does not yet know, as a 'seed' account. Address comparison
 * is case-insensitive. Returns the new list and whether anything was added, so
 * the caller can skip the storage write when nothing changed.
 */
export function mergeSignerWalletsIntoList(
  stored: AccountListItem[],
  signerAddresses: string[],
): { list: AccountListItem[]; added: boolean } {
  const known = new Set(stored.map((a) => a.address.toLowerCase()));
  const list = [...stored];
  let added = false;
  for (const address of signerAddresses) {
    if (!address) continue;
    const key = address.toLowerCase();
    if (!known.has(key)) {
      list.push({ address, source: 'seed' });
      known.add(key);
      added = true;
    }
  }
  return { list, added };
}

/**
 * Pick which wallet to adopt as active when the renderer has none stored:
 * prefer the signer's own active pointer when it is a real wallet, else the
 * first signer wallet. Returns undefined when there is nothing to adopt.
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
