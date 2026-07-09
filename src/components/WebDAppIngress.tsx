/**
 * Web dApp-connect ingress (analogue of DesktopDAppBridge for the plain
 * browser build). Mounted only outside the desktop shell and the native app:
 *
 *  - consumes the `#qrlconnect=<encoded uri>` fragment a dApp's
 *    "Open web wallet" link left in the URL. The fresh-tab case is captured
 *    and scrubbed synchronously at app entry (fragmentCapture.ts, before
 *    RouteMonitor's restore-navigation can erase it); this component picks
 *    up that stash on mount and additionally handles hashchange, because a
 *    link that navigates an ALREADY-open wallet tab to the same path with a
 *    new fragment does not reload the page.
 *  - stages valid URIs behind the consent modal
 *    (dappConnectStore.requestDesktopConnect); the modal remains the single
 *    gate before any relay contact.
 *
 * Desktop must never mount this: its hash router owns the fragment.
 */

import { useEffect } from 'react';
import { useStore } from '@/stores/store';
import { isDesktop } from '@/desktop/bridge';
import { isInNativeApp } from '@/utils/nativeApp';
import {
  rawLocationHash,
  takeCapturedFragment,
} from '@/services/dappConnect/fragmentCapture';
import {
  extractPairingUriFromFragment,
  fragmentHasPairingKey,
} from '@/services/dappConnect/fragmentIngress';

const WebDAppIngress = () => {
  const { dappConnectStore } = useStore();

  useEffect(() => {
    if (isDesktop || isInNativeApp()) return;

    const stage = (hash: string) => {
      const uri = extractPairingUriFromFragment(hash);
      if (uri !== null) {
        dappConnectStore.requestDesktopConnect(uri, 'link');
      } else {
        console.warn('[DAppConnect] ignoring malformed qrlconnect fragment');
      }
    };

    // Fresh tab: the fragment was captured and scrubbed at app entry.
    const captured = takeCapturedFragment();
    if (captured !== null) stage(captured);

    // Already-open tab: same-path navigation with a new fragment only fires
    // hashchange. Scrub first (bearer offer; also makes re-entry a no-op),
    // preserving the router's history state.
    const onHashChange = () => {
      const hash = rawLocationHash();
      if (!fragmentHasPairingKey(hash)) return;
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search
      );
      stage(hash);
    };

    onHashChange();
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [dappConnectStore]);

  return null;
};

export default WebDAppIngress;
