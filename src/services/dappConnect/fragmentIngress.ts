/**
 * Web-only pairing ingress: parsing helpers for the URL-fragment handoff.
 *
 * A dApp opens `https://qrlwallet.com/dapp-sessions#qrlconnect=<enc(uri)>`.
 * The pairing URI is a bearer offer, so it travels in the fragment (never
 * sent to servers, absent from referrers) and the caller scrubs it from the
 * address bar before staging it behind the consent modal.
 */

import { DAppConnectService } from './DAppConnectService';

export const FRAGMENT_PARAM = 'qrlconnect';

const paramsFromHash = (hash: string): URLSearchParams =>
  new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

/**
 * Extract a pairing URI from a location.hash-shaped string. Returns null
 * when the key is absent or the value is not a qrlconnect:// URI.
 *
 * Note: URLSearchParams already percent-decodes; decoding again here would
 * corrupt URIs whose payload contains literal %xx sequences.
 */
export function extractPairingUriFromFragment(hash: string): string | null {
  const value = paramsFromHash(hash).get(FRAGMENT_PARAM);
  if (value === null) return null;
  return DAppConnectService.isConnectionURI(value) ? value : null;
}

/**
 * Whether the fragment carries the pairing key at all (valid or not); the
 * ingress scrubs the fragment whenever this is true, so even a malformed
 * bearer-looking blob never lingers in the address bar.
 */
export function fragmentHasPairingKey(hash: string): boolean {
  return paramsFromHash(hash).has(FRAGMENT_PARAM);
}
