/**
 * Startup capture for the #qrlconnect= web pairing fragment.
 *
 * Must run synchronously at app entry, BEFORE the router mounts:
 * RouteMonitor navigates on mount (restoring the last active page), which
 * would otherwise discard the fragment before the lazy ingress chunk loads
 * AND leave the bearer URI in an intact history entry. Capturing here
 * scrubs the address bar immediately and stashes the raw hash for
 * WebDAppIngress to validate and stage once React is up.
 *
 * Deliberately import-light (no dApp-connect service graph) so it is safe
 * in the entry chunk. Reads the hash via new URL(href) rather than
 * location.hash: Firefox percent-decodes the latter, which would corrupt
 * encoded URIs before parsing.
 */

import { isDesktop } from '@/desktop/bridge';
import { isInNativeApp } from '@/utils/nativeApp';

export const FRAGMENT_KEY = 'qrlconnect';

let capturedHash: string | null = null;

/** The raw (undecoded) fragment of the current URL, without Firefox's
 *  location.hash percent-decoding. */
export const rawLocationHash = (): string => new URL(window.location.href).hash;

const hasFragmentKey = (hash: string): boolean =>
  new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).has(FRAGMENT_KEY);

/**
 * Web builds only: if the URL carries a qrlconnect fragment, stash it and
 * scrub it from the address bar (preserving the history state object so
 * the router's entry bookkeeping survives). Idempotent.
 */
export function captureQrlconnectFragment(): void {
  if (typeof window === 'undefined' || isDesktop || isInNativeApp()) return;
  const hash = rawLocationHash();
  if (!hasFragmentKey(hash)) return;
  capturedHash = hash;
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search
  );
}

/** Hand the stashed fragment to the ingress exactly once. */
export function takeCapturedFragment(): string | null {
  const hash = capturedHash;
  capturedHash = null;
  return hash;
}
