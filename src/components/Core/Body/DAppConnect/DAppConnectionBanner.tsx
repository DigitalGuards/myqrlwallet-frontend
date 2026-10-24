import { isPendingDAppInfo } from "@/services/dappConnect/dappMetadata";
/**
 * DApp Connection Banner - Shows active dApp connections status.
 * Displays as a persistent indicator at the top of the wallet.
 */

import { useTranslation } from "react-i18next";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { SessionStatus } from "@/services/dappConnect/types";

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
const statusLabels: Record<
  SessionStatus,
  "connected" | "reconnecting" | "connecting" | "exchangingKeys" | "offline"
> = {
  [SessionStatus.CONNECTED]: "connected",
  [SessionStatus.RECONNECTING]: "reconnecting",
  [SessionStatus.CONNECTING]: "connecting",
  [SessionStatus.KEY_EXCHANGE]: "exchangingKeys",
  [SessionStatus.DISCONNECTED]: "offline",
};

const DAppPulsingDot = ({ status }: { status: SessionStatus }) => {
  const color = statusDotColors[status];
  const isStable = status === SessionStatus.CONNECTED;

  return (
    <div
      className="relative flex h-2 w-2 items-center justify-center rounded-full"
      style={{ backgroundColor: `${color}66` }}
    >
      <div
        className={`absolute flex h-3 w-3 items-center justify-center rounded-full ${
          isStable
            ? "animate-[slow-ping_2s_cubic-bezier(0,0,0.2,1)_infinite]"
            : "animate-ping"
        }`}
        style={{ backgroundColor: color, opacity: 0.75 }}
      />
      <div
        className="absolute flex h-2 w-2 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}e6` }}
      />
    </div>
  );
};

function BannerRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const button = row.querySelector("button");
    const info = row.firstElementChild;
    if (!button || !info) return;
    // Preserve the existing layout whenever its action fits the viewport,
    // including rows whose text uses the trailing padding. Measure again on
    // translation, metadata, font or viewport changes before allowing wrapping.
    const measure = () => {
      delete row.dataset["wrap"];
      const bounds = button.getBoundingClientRect();
      if (bounds.right > window.innerWidth || bounds.left < 0)
        row.dataset["wrap"] = "true";
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(info);
    observer.observe(button);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children]);
  return (
    <div
      ref={ref}
      className="group/banner flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-xs"
    >
      {children}
    </div>
  );
}

const DAppConnectionBanner = observer(() => {
  const { t } = useTranslation("settings");
  const { dappConnectStore } = useStore();
  const { activeSessions } = dappConnectStore;

  if (activeSessions.length === 0) return null;

  return (
    <div className="space-y-1 px-4 pb-2">
      <style>{`
        @keyframes slow-ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
      `}</style>
      {activeSessions.map((session) => (
        <BannerRow key={session.id}>
          <div className="flex items-center gap-2 group-data-[wrap=true]/banner:min-w-0 group-data-[wrap=true]/banner:flex-wrap group-data-[wrap=true]/banner:gap-y-1">
            <DAppPulsingDot status={session.status} />
            <span className="font-medium group-data-[wrap=true]/banner:min-w-0 group-data-[wrap=true]/banner:break-all">
              {!session.originatorInfoReceived &&
              isPendingDAppInfo(session.dappInfo)
                ? t("connecting")
                : session.dappInfo.name}
            </span>
            <span className="text-muted-foreground">
              {t(statusLabels[session.status])}
            </span>
          </div>
          <button
            onClick={() => {
              dappConnectStore.disconnectSession(session.id);
            }}
            className="text-muted-foreground hover:text-destructive group-data-[wrap=true]/banner:shrink-0"
          >
            {t("disconnect")}
          </button>
        </BannerRow>
      ))}
    </div>
  );
});

export default DAppConnectionBanner;
