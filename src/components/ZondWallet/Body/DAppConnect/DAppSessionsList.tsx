/**
 * DApp Sessions List - Management page for active dApp connections.
 * Accessible from Settings.
 */

import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/store';
import { Button } from '@/components/UI/Button';
import { SessionStatus } from '@/services/dappConnect/types';

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

const DAppPulsingDot = ({ status }: { status: SessionStatus }) => {
  const color = statusDotColors[status];
  const isStable = status === SessionStatus.CONNECTED;

  return (
    <div
      className="relative flex h-2.5 w-2.5 items-center justify-center rounded-full"
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

const DAppSessionsList = observer(() => {
  const { dappConnectStore } = useStore();
  const { activeSessions } = dappConnectStore;

  return (
    <div className="space-y-4 p-4">
      <style>{`
        @keyframes slow-ping {
          75%, 100% {
            transform: scale(2);
            opacity: 0;
          }
        }
      `}</style>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Connected dApps</h2>
        {activeSessions.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => dappConnectStore.disconnectAll()}
          >
            Disconnect All
          </Button>
        )}
      </div>

      {activeSessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No dApps connected. Scan a QR code from a dApp to connect.
        </p>
      ) : (
        <div className="space-y-3">
          {activeSessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between rounded-lg border border-border p-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <DAppPulsingDot status={session.status} />
                  <span className="font-semibold">{session.dappInfo.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {statusLabels[session.status]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{session.dappInfo.url}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  Account: {session.connectedAccount
                    ? `${session.connectedAccount.slice(0, 8)}...${session.connectedAccount.slice(-6)}`
                    : 'None'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Connected {new Date(session.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => dappConnectStore.disconnectSession(session.id)}
              >
                Disconnect
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default DAppSessionsList;
