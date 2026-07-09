/**
 * Desktop dApp-connect consent modal.
 *
 * On mobile the physical QR scan IS the user's consent to pair. On desktop
 * the qrlconnect:// OS protocol handler lets ANY webpage or local process
 * fire connection URIs at the wallet, so this modal restores the missing
 * consent step: no relay contact, no handshake, and no account disclosure
 * happen until the user explicitly confirms. Declining drops the URI with
 * zero network traffic.
 *
 * The dApp's identity is only learned AFTER the handshake (ORIGINATOR_INFO),
 * so the modal can only show the relay the URI points at; the copy therefore
 * anchors consent to the user's own action ("did you just click Connect?").
 */

import { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/stores/store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/UI/Dialog';
import { Button } from '@/components/UI/Button';
import { Loader, Plug } from 'lucide-react';
import { parseConnectionURI } from '@/services/dappConnect/qrUri';
import { DEFAULT_RELAY_URL } from '@/services/dappConnect/DAppConnectService';

/** Origin the wallet dials when a URI carries no r= param. */
const DEFAULT_RELAY_ORIGIN = new URL(DEFAULT_RELAY_URL).origin;

const DAppConnectConsentModal = observer(() => {
  const { dappConnectStore } = useStore();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  // Relay origin the wallet will actually dial. Resolved via the SAME audited
  // parser the connect path uses (parseConnectionURI) so the displayed relay
  // cannot diverge from the one handleConnectionURI contacts; defaults until
  // the async parse resolves and on any parse failure.
  const [relayOrigin, setRelayOrigin] = useState(DEFAULT_RELAY_ORIGIN);

  const uri = dappConnectStore.desktopConnectUri;
  const source = dappConnectStore.desktopConnectSource;

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    void parseConnectionURI(uri)
      .then((parsed) => {
        if (cancelled) return;
        setRelayOrigin(parsed.relayUrl ? new URL(parsed.relayUrl).origin : DEFAULT_RELAY_ORIGIN);
      })
      .catch(() => {
        if (!cancelled) setRelayOrigin(DEFAULT_RELAY_ORIGIN);
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const handleCancel = useCallback(() => {
    if (connecting) return;
    setError('');
    dappConnectStore.clearDesktopConnect();
  }, [connecting, dappConnectStore]);

  const handleConnect = useCallback(async () => {
    setError('');
    setConnecting(true);
    try {
      const result = await dappConnectStore.confirmDesktopConnect();
      if (result.success) {
        navigate('/dapp-sessions');
      } else {
        setError(result.error || 'Connection failed');
      }
    } finally {
      setConnecting(false);
    }
  }, [dappConnectStore, navigate]);

  if (!uri) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            Connect to a dApp?
          </DialogTitle>
          <DialogDescription>
            {source === 'paste'
              ? 'You pasted a dApp connection code.'
              : source === 'link'
                ? 'You opened a dApp connection link. The dApp may be open in another tab or on another device.'
                : 'A dApp is requesting to connect to your wallet via QRL Connect.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Relay: <span className="font-mono">{relayOrigin}</span>
          </p>
          <p>
            Connecting shares your active account address with the dApp. Its
            name and site are only verified after the encrypted channel is
            established. Only continue if you just clicked Connect in a dApp,
            opened its connection link, or pasted its connection code yourself.
          </p>
          {error && <p className="text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={connecting}>
            Cancel
          </Button>
          <Button onClick={() => void handleConnect()} disabled={connecting}>
            {connecting ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              'Connect'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default DAppConnectConsentModal;
