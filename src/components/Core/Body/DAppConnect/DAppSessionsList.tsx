/**
 * DApp Sessions List - management surface for active dApp connections.
 * Rendered inside a Card by both hosts: Settings embeds it, and the
 * standalone /dapp-sessions route (the web fragment-link landing) wraps it
 * in DAppSessionsPage.
 */

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Plug, Unplug } from 'lucide-react';
import { useStore } from '@/stores/store';
import { Button } from '@/components/UI/Button';
import { Input } from '@/components/UI/Input';
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/UI/Card';
import { SessionStatus } from '@/services/dappConnect/types';
import { DAppConnectService } from '@/services/dappConnect/DAppConnectService';
import { isDesktop } from '@/desktop/bridge';
import { isInNativeApp } from '@/utils/nativeApp';

const statusDotColors: Record<SessionStatus, string> = {
  [SessionStatus.CONNECTED]: '#3b82f6',     // blue-500
  [SessionStatus.RECONNECTING]: '#eab308',   // yellow-500
  [SessionStatus.CONNECTING]: '#eab308',     // yellow-500
  [SessionStatus.KEY_EXCHANGE]: '#eab308',   // yellow-500
  [SessionStatus.DISCONNECTED]: '#ef4444',   // red-500
};

const statusLabels: Record<SessionStatus, string> = {
  [SessionStatus.CONNECTED]: 'Connected',
  [SessionStatus.RECONNECTING]: 'Reconnecting...',
  [SessionStatus.CONNECTING]: 'Connecting...',
  [SessionStatus.KEY_EXCHANGE]: 'Exchanging keys...',
  [SessionStatus.DISCONNECTED]: 'Disconnected',
};

const statusPillClasses: Record<SessionStatus, string> = {
  [SessionStatus.CONNECTED]: 'bg-blue-500/10 text-blue-400',
  [SessionStatus.RECONNECTING]: 'bg-yellow-500/10 text-yellow-500',
  [SessionStatus.CONNECTING]: 'bg-yellow-500/10 text-yellow-500',
  [SessionStatus.KEY_EXCHANGE]: 'bg-yellow-500/10 text-yellow-500',
  [SessionStatus.DISCONNECTED]: 'bg-red-500/10 text-red-400',
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
          isStable ? 'animate-[slow-ping_2s_cubic-bezier(0,0,0.2,1)_infinite]' : 'animate-ping'
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
  const { dappConnectStore } = useStore();
  const [open, setOpen] = useState(false);
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const trimmed = uri.trim();
    if (!DAppConnectService.isConnectionURI(trimmed)) {
      setError('Not a qrlconnect:// connection code');
      return;
    }
    setError('');
    setUri('');
    setOpen(false);
    dappConnectStore.requestDesktopConnect(trimmed, 'paste');
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plug className="mr-2 h-4 w-4" />
          Connect a dApp
        </Button>
        <p className="text-xs text-muted-foreground">
          Paste a connection code from a dApp's pairing dialog.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-xl items-start gap-2">
      <div className="flex-1 space-y-1">
        <Input
          value={uri}
          onChange={(e) => {
            setUri(e.target.value);
            if (error) setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Paste a qrlconnect:// connection code"
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <Button size="sm" onClick={submit}>
        Connect
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(false);
          setUri('');
          setError('');
        }}
      >
        Cancel
      </Button>
    </div>
  );
});

const emptyStateHint = isDesktop
  ? 'Click "Open in MyQRLWallet" in a dApp, or paste its connection code above.'
  : isInNativeApp()
    ? 'Scan a QR code from a dApp to connect.'
    : 'Click "Open web wallet" in a dApp pairing dialog, or paste its connection code above.';

const DAppSessionsList = observer(() => {
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
      <CardHeader className="bg-gradient-to-r from-blue-accent/5 to-transparent">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-xl font-bold">dApp connections</CardTitle>
            <CardDescription>
              dApps paired with this wallet over the end-to-end encrypted QRL Connect relay.
            </CardDescription>
          </div>
          {activeSessions.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => dappConnectStore.disconnectAll()}
            >
              Disconnect all
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {(isDesktop || !isInNativeApp()) && <PasteConnect />}

        {activeSessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
            <Unplug className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No dApps connected</p>
            <p className="max-w-sm px-4 text-xs leading-relaxed text-muted-foreground">
              {emptyStateHint}
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
                  <div className="flex items-center gap-2.5">
                    <DAppPulsingDot status={session.status} />
                    <span className="truncate font-semibold">{session.dappInfo.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusPillClasses[session.status]}`}
                    >
                      {statusLabels[session.status]}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{session.dappInfo.url}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {session.connectedAccount ? (
                      <span className="font-mono">
                        {session.connectedAccount.slice(0, 8)}...{session.connectedAccount.slice(-6)}
                      </span>
                    ) : (
                      <span className="italic">No account shared</span>
                    )}
                    <span>
                      Connected {new Date(session.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => dappConnectStore.disconnectSession(session.id)}
                >
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </>
  );
});

export default DAppSessionsList;
