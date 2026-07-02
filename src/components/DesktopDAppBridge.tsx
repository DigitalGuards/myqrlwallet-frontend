/**
 * Desktop dApp-connect bridge (analogue of NativeAppBridge for the Electron
 * shell). Mounted only when running inside the desktop app (isDesktop):
 *
 *  - subscribes to qrlconnect:// URIs forwarded by the main process (OS
 *    protocol handler, cold or warm start) and stages them behind the
 *    consent modal (dappConnectStore.requestDesktopConnect); the modal is
 *    the single gate before any relay contact.
 *  - renders that consent modal.
 *
 * Main already shape-validates and rate-limits the URIs; parsing and
 * fingerprint pinning happen in the audited dApp-connect stack only after
 * the user consents.
 */

import { useEffect } from 'react';
import { useStore } from '@/stores/store';
import { desktopSigner, isDesktop } from '@/desktop/bridge';
import DAppConnectConsentModal from './Core/Body/DAppConnect/DAppConnectConsentModal';

const DesktopDAppBridge = () => {
  const { dappConnectStore } = useStore();

  useEffect(() => {
    if (!isDesktop) return;
    const unsubscribe = desktopSigner.onDAppConnectUri((uri) => {
      dappConnectStore.requestDesktopConnect(uri, 'deeplink');
    });
    return unsubscribe;
  }, [dappConnectStore]);

  if (!isDesktop) return null;
  return <DAppConnectConsentModal />;
};

export default DesktopDAppBridge;
