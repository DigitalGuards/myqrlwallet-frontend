import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { isCallable, isRecord } from "@/utils/guards";
import { logger } from "@/utils/log";
import { serverUrl } from "./config";
import {
  Activity,
  Bell,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  Wallet,
} from "lucide-react";

type HealthState = "loading" | "ok" | "degraded";

interface TelegramWebApp {
  ready: () => unknown;
  expand: () => unknown;
  openLink: (url: string) => unknown;
}

function isTelegramWebApp(value: unknown): value is TelegramWebApp {
  return (
    isRecord(value) &&
    isCallable(value["ready"]) &&
    isCallable(value["expand"]) &&
    isCallable(value["openLink"])
  );
}

function getTelegramWebApp(): TelegramWebApp | null {
  const telegram: unknown = "Telegram" in window ? window.Telegram : undefined;
  const webApp = isRecord(telegram) ? telegram["WebApp"] : undefined;
  return isTelegramWebApp(webApp) ? webApp : null;
}

export default function TelegramControlCenter() {
  const [health, setHealth] = useState<HealthState>("loading");
  const navigate = useNavigate();

  useEffect(() => {
    const webApp = getTelegramWebApp();
    webApp?.ready();
    webApp?.expand();
    void fetch(`${serverUrl.replace(/\/$/, "")}/telegram/status`)
      .then((response) => {
        setHealth(response.ok ? "ok" : "degraded");
      })
      .catch(() => {
        setHealth("degraded");
      });
  }, []);

  // Inside Telegram the mini app has to hand the route to the Telegram client
  // as an absolute URL. Everywhere else this is an in-app route, so the router
  // handles it. Assigning window.location would leave the document under hash
  // routing (desktop shell, app-shipped embedded build), and in the embedded
  // build it would fetch the path from the live server.
  const openWallet = (path: string) => {
    const webApp = getTelegramWebApp();
    if (webApp) {
      webApp.openLink(new URL(path, window.location.origin).toString());
      return;
    }
    void Promise.resolve(navigate(path)).catch((error: unknown) => {
      logger.error("Failed to open wallet page:", error);
    });
  };

  const statusLabel =
    health === "loading"
      ? "Checking network"
      : health === "ok"
        ? "Operational"
        : "Degraded";
  const statusColor =
    health === "ok"
      ? "bg-success"
      : health === "loading"
        ? "bg-identity-accent"
        : "bg-destructive";

  return (
    <main className="min-h-dvh bg-background px-4 pb-10 pt-6 text-foreground">
      <div className="mx-auto max-w-lg">
        <header className="mb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
            MyQRLWallet
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Control center
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Monitor services and open wallet actions securely.
          </p>
        </header>

        <section className="mb-4 rounded-2xl border border-border bg-card p-5 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${statusColor}`}
                aria-hidden="true"
              />
              <div>
                <p className="text-xs text-muted-foreground">Network status</p>
                <p className="font-display text-lg font-semibold">
                  {statusLabel}
                </p>
              </div>
            </div>
            <Activity
              className="h-5 w-5 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3" aria-label="Wallet actions">
          <button
            className="rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60"
            onClick={() => {
              openWallet("/");
            }}
          >
            <Wallet className="mb-8 h-5 w-5 text-primary" aria-hidden="true" />
            <span className="block font-display font-semibold">
              Open wallet
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              View accounts and balance
            </span>
          </button>
          <button
            className="rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60"
            onClick={() => {
              openWallet("/tx-history");
            }}
          >
            <Activity
              className="mb-8 h-5 w-5 text-primary"
              aria-hidden="true"
            />
            <span className="block font-display font-semibold">Activity</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Review wallet history
            </span>
          </button>
        </section>

        <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <button
            className="flex w-full items-center gap-3 border-b border-border p-4 text-left hover:bg-accent"
            onClick={() => {
              openWallet("/dapp-sessions");
            }}
          >
            <ExternalLink
              className="h-5 w-5 text-identity-accent"
              aria-hidden="true"
            />
            <span className="flex-1">
              <span className="block font-medium">Connected apps</span>
              <span className="block text-xs text-muted-foreground">
                Review active dApp sessions
              </span>
            </span>
            <ChevronRight
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
          <button
            className="flex w-full items-center gap-3 border-b border-border p-4 text-left hover:bg-accent"
            onClick={() => {
              openWallet("/settings");
            }}
          >
            <Bell className="h-5 w-5 text-identity-accent" aria-hidden="true" />
            <span className="flex-1">
              <span className="block font-medium">Alerts and settings</span>
              <span className="block text-xs text-muted-foreground">
                Configure your wallet
              </span>
            </span>
            <ChevronRight
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
          <div className="flex items-start gap-3 p-4">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-success"
              aria-hidden="true"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Seeds, private keys, PINs, and signing remain inside MyQRLWallet.
              The Telegram bot never requests them.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
