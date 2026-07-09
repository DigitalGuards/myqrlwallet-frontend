/**
 * Web dApp-connect ingress (analogue of DesktopDAppBridge for the plain
 * browser build). Mounted only outside the desktop shell and the native app:
 *
 *  - reads a `#qrlconnect=<encoded uri>` fragment left by a dApp's
 *    "Open web wallet" link, scrubs it from the address bar FIRST (the URI
 *    is a bearer pairing offer; scrub-first also makes StrictMode's double
 *    effect run a no-op), then stages it behind the consent modal
 *    (dappConnectStore.requestDesktopConnect). The modal remains the single
 *    gate before any relay contact.
 *
 * Desktop must never mount this: its hash router owns the fragment.
 */

import { useEffect } from 'react';
import { useStore } from '@/stores/store';
import { isDesktop } from '@/desktop/bridge';
import { isInNativeApp } from '@/utils/nativeApp';
import {
  extractPairingUriFromFragment,
  fragmentHasPairingKey,
} from '@/services/dappConnect/fragmentIngress';

const WebDAppIngress = () => {
  const { dappConnectStore } = useStore();

  useEffect(() => {
    if (isDesktop || isInNativeApp()) return;

    const consumeFragment = () => {
      const hash = window.location.hash;
      if (!fragmentHasPairingKey(hash)) return;
      const uri = extractPairingUriFromFragment(hash);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      if (uri !== null) {
        dappConnectStore.requestDesktopConnect(uri, 'link');
      } else {
        console.warn('[DAppConnect] ignoring malformed qrlconnect fragment');
      }
    };

    // On mount (fresh tab), and on hashchange: a link that navigates an
    // ALREADY-open wallet tab to the same path with a new fragment does not
    // reload the page, it only fires hashchange.
    consumeFragment();
    window.addEventListener('hashchange', consumeFragment);
    return () => {
      window.removeEventListener('hashchange', consumeFragment);
    };
  }, [dappConnectStore]);

  return null;
};

export default WebDAppIngress;
