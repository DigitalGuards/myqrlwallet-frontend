import { useEffect, useState } from "react";
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
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string) => void;
  themeParams?: Record<string, string>;
}

function getTelegramWebApp(): TelegramWebApp | null {
  const telegram = (
    window as Window & { Telegram?: { WebApp?: TelegramWebApp } }
  ).Telegram;
  return telegram?.WebApp ?? null;
}

const serverUrl = import.meta.env.PROD
  ? (import.meta.env["VITE_SERVER_URL_PRODUCTION"] ?? "/api")
  : (import.meta.env["VITE_SERVER_URL_DEVELOPMENT"] ??
    "http://localhost:3000/api");

export default function TelegramControlCenter() {
  const [health, setHealth] = useState<HealthState>("loading");

  useEffect(() => {
    const webApp = getTelegramWebApp();
    webApp?.ready();
    webApp?.expand();
    fetch(`${serverUrl.replace(/\/$/, "")}/telegram/status`)
      .then((response) => setHealth(response.ok ? "ok" : "degraded"))
      .catch(() => setHealth("degraded"));
  }, []);

  const openWallet = (path: string) => {
    const url = new URL(path, window.location.origin).toString();
    const webApp = getTelegramWebApp();
    if (webApp) webApp.openLink(url);
    else window.location.assign(url);
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
            onClick={() => openWallet("/")}
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
            onClick={() => openWallet("/tx-history")}
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
            onClick={() => openWallet("/dapp-sessions")}
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
            onClick={() => openWallet("/settings")}
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
