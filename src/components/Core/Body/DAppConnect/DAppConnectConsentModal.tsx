import { useTranslation } from "react-i18next";
/**
 * Desktop dApp-connect consent modal.
 *
 * On mobile the physical QR scan IS the user's consent to pair. On desktop
 * the qrlconnect:// OS protocol handler lets ANY webpage or local process
 * fire connection URIs at the wallet, so this modal restores the missing
 * consent step: no relay contact or encrypted handshake happens until the
 * user explicitly confirms. Pairing itself discloses no account; account
 * access requires a later, separate qrl_requestAccounts approval.
 *
 * The dApp's identity is only learned AFTER the handshake (ORIGINATOR_INFO),
 * so the modal can only show the relay the URI points at; the copy therefore
 * anchors consent to the user's own action ("did you just click Connect?").
 */

import { dappMessage } from "@/i18n/dappMessage";
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate } from "react-router";
import { useStore } from "@/stores/store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/UI/Dialog";
import { Button } from "@/components/UI/Button";
import { Loader, Plug } from "lucide-react";
import { parseConnectionURI } from "@/services/dappConnect/qrUri";
import { DEFAULT_RELAY_URL } from "@/services/dappConnect/DAppConnectService";

/** Origin the wallet dials when a URI carries no r= param. */
const DEFAULT_RELAY_ORIGIN = new URL(DEFAULT_RELAY_URL).origin;

const DAppConnectConsentModal = observer(() => {
  const { t } = useTranslation(["dapps", "common", "settings", "transfer"]);
  const { dappConnectStore, qrlStore } = useStore();
  // Keep the existing account prerequisite as UX: pairing itself shares no
  // account, but this wallet cannot satisfy a later account request without one.
  // activeAccount hydrates asynchronously on boot, so suppress the warning
  // (not the gate) until the store settles: a fragment-link cold load can
  // stage this modal before hydration finishes.
  const hasAccount = Boolean(qrlStore.activeAccount.accountAddress);
  const isInitializing =
    !qrlStore.qrlInstance || qrlStore.qrlAccounts.isLoading;
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
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
        setRelayOrigin(
          parsed.relayUrl
            ? new URL(parsed.relayUrl).origin
            : DEFAULT_RELAY_ORIGIN,
        );
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
    setError("");
    dappConnectStore.clearDesktopConnect();
  }, [connecting, dappConnectStore]);

  const handleConnect = useCallback(async () => {
    setError("");
    setConnecting(true);
    try {
      const result = await dappConnectStore.confirmDesktopConnect();
      if (result.success) {
        void navigate("/dapp-sessions");
      } else {
        setError(result.error?.trim() ? result.error : "Connection failed");
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
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-md flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            {t("dapps:consentTitle")}
          </DialogTitle>
          <DialogDescription>
            {source === "paste"
              ? t("dapps:consentPaste")
              : source === "link"
                ? t("dapps:consentLink")
                : t("dapps:consentProtocol")}
          </DialogDescription>
        </DialogHeader>

        <div
          role="region"
          aria-label={t("dapps:connectionDetails")}
          className="min-h-0 space-y-2 overflow-y-auto overscroll-contain text-sm"
        >
          <p className="break-all text-muted-foreground">
            {t("dapps:relay")} <span className="font-mono">{relayOrigin}</span>
          </p>
          <p>{t("dapps:consentWarning")}</p>
          {!hasAccount && !isInitializing && (
            <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-yellow-500">
              {t("dapps:accountRequired")}
            </p>
          )}
          {error && (
            <p role="alert" className="break-words text-destructive">
              {dappMessage(error, t)}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={connecting}
          >
            {t("common:cancel")}
          </Button>
          <Button
            onClick={() => void handleConnect()}
            disabled={connecting || !hasAccount}
          >
            {connecting ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                {t("settings:connecting")}
              </>
            ) : (
              t("settings:connect")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default DAppConnectConsentModal;
