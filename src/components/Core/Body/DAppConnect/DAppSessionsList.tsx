import { useTranslation } from "react-i18next";
/**
 * DApp Sessions List - management surface for active dApp connections.
 * Rendered inside a Card by both hosts: Settings embeds it, and the
 * standalone /dapp-sessions route (the web fragment-link landing) wraps it
 * in DAppSessionsPage.
 */

import { useState } from "react";
import { observer } from "mobx-react-lite";
import { Plug, Unplug } from "lucide-react";
import { useStore } from "@/stores/store";
import { Button } from "@/components/UI/Button";
import { Input } from "@/components/UI/Input";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { SessionStatus } from "@/services/dappConnect/types";
import { DAppConnectService } from "@/services/dappConnect/DAppConnectService";
import { isDesktop } from "@/desktop/bridge";
import { isInNativeApp } from "@/utils/nativeApp";
import { QrlAddress } from "@/components/UI/QrlAddress";

const statusDotColors: Record<SessionStatus, string> = {
  [SessionStatus.CONNECTED]: "#3fba82", // success green
  [SessionStatus.RECONNECTING]: "#eab308", // yellow-500
  [SessionStatus.CONNECTING]: "#eab308", // yellow-500
  [SessionStatus.KEY_EXCHANGE]: "#eab308", // yellow-500
  [SessionStatus.DISCONNECTED]: "#ef4444", // red-500
};

// A stored session with no live socket. The pairing is kept and retried on
// the next foreground, reload or user action, so the label says so: plain
// "Disconnected" read as over and done with, and users unpaired by hand.
const statusLabels = {
  [SessionStatus.CONNECTED]: "settings:connected",
  [SessionStatus.RECONNECTING]: "settings:reconnecting",
  [SessionStatus.CONNECTING]: "settings:connecting",
  [SessionStatus.KEY_EXCHANGE]: "settings:exchangingKeys",
  [SessionStatus.DISCONNECTED]: "settings:offline",
} as const;

const statusPillClasses: Record<SessionStatus, string> = {
  [SessionStatus.CONNECTED]: "bg-success/10 text-success",
  [SessionStatus.RECONNECTING]: "bg-yellow-500/10 text-yellow-500",
  [SessionStatus.CONNECTING]: "bg-yellow-500/10 text-yellow-500",
  [SessionStatus.KEY_EXCHANGE]: "bg-yellow-500/10 text-yellow-500",
  [SessionStatus.DISCONNECTED]: "bg-red-500/10 text-red-400",
};

const DAppPulsingDot = ({ status }: { status: SessionStatus }) => {
  const color = statusDotColors[status];
  const isStable = status === SessionStatus.CONNECTED;

  return (
    <div
      className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: `${color}66` }}
    >
      <div
        className={`absolute flex h-3.5 w-3.5 items-center justify-center rounded-full ${
          isStable
            ? "animate-[slow-ping_2s_cubic-bezier(0,0,0.2,1)_infinite]"
            : "animate-ping"
        }`}
        style={{ backgroundColor: color, opacity: 0.75 }}
      />
      <div
        className="absolute flex h-2.5 w-2.5 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}e6` }}
      />
    </div>
  );
};

/**
 * Paste entry (desktop + web): the fallback ingress when neither the
 * qrlconnect:// protocol handler nor the web fragment link is available
 * (unregistered, blocked, or the dApp is on another machine so only its
 * QR/URI text can travel). Feeds the exact same consent modal as the other
 * ingresses; no relay contact happens here.
 */
const PasteConnect = observer(() => {
  const { t } = useTranslation(["settings", "common"]);
  const { dappConnectStore } = useStore();
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    const trimmed = uri.trim();
    if (!DAppConnectService.isConnectionURI(trimmed)) {
      setError(true);
      return;
    }
    setError(false);
    setUri("");
    setOpen(false);
    dappConnectStore.requestDesktopConnect(trimmed, "paste");
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          <Plug className="mr-2 h-4 w-4" />
          {t("settings:connectDapp")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("settings:pasteHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl flex-wrap items-start gap-2">
      <div className="min-w-0 flex-[1_1_12rem] space-y-1">
        <Input
          value={uri}
          onChange={(e) => {
            setUri(e.target.value);
            if (error) setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={t("settings:pasteCode")}
          autoFocus
        />
        {error && (
          <p className="text-xs text-destructive">
            {t("settings:invalidCode")}
          </p>
        )}
      </div>
      <Button size="sm" onClick={submit}>
        {t("settings:connect")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(false);
          setUri("");
          setError(false);
        }}
      >
        {t("common:cancel")}
      </Button>
    </div>
  );
});

const DAppSessionsList = observer(
  ({ showHeading = true }: { showHeading?: boolean }) => {
    const { t } = useTranslation(["settings", "common"]);
    const { dappConnectStore } = useStore();
    const { activeSessions } = dappConnectStore;

    return (
      <>
        <style>{`
        @keyframes slow-ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
      `}</style>
        {showHeading && (
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-xl font-bold">
                  {t("settings:sessions")}
                </CardTitle>
                <CardDescription>{t("settings:sessionsHint")}</CardDescription>
              </div>
              {activeSessions.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    dappConnectStore.disconnectAll();
                  }}
                >
                  {t("settings:disconnectAll")}
                </Button>
              )}
            </div>
          </CardHeader>
        )}
        <CardContent className="space-y-4 pt-6">
          {(isDesktop || !isInNativeApp()) && <PasteConnect />}

          {activeSessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
              <Unplug className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">{t("settings:noDapps")}</p>
              <p className="max-w-sm px-4 text-xs leading-relaxed text-muted-foreground">
                {t(
                  isDesktop
                    ? "settings:emptyDesktop"
                    : isInNativeApp()
                      ? "settings:emptyMobile"
                      : "settings:emptyWeb",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/20 p-4"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <DAppPulsingDot status={session.status} />
                      <span className="truncate font-semibold">
                        {session.dappInfo.name}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusPillClasses[session.status]}`}
                      >
                        {t(statusLabels[session.status])}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {session.dappInfo.url}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {session.connectedAccount ? (
                        <QrlAddress
                          address={session.connectedAccount}
                          revealable
                        />
                      ) : (
                        <span className="italic">
                          {t("settings:noAccount")}
                        </span>
                      )}
                      <span>
                        {t("settings:connectedOn", {
                          date: new Date(
                            session.createdAt,
                          ).toLocaleDateString(),
                        })}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      dappConnectStore.disconnectSession(session.id);
                    }}
                  >
                    {t("settings:disconnect")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </>
    );
  },
);

export default DAppSessionsList;
