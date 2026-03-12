/**
 * DApp Connection Banner - Shows active dApp connections status.
 * Displays as a persistent indicator at the top of the wallet.
 */

import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/store';
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
      className="relative flex h-2 w-2 items-center justify-center rounded-full"
      style={{ backgroundColor: `${color}66` }}
    >
      <div
        className={`absolute flex h-3 w-3 items-center justify-center rounded-full ${
          isStable ? 'animate-[slow-ping_2s_cubic-bezier(0,0,0.2,1)_infinite]' : 'animate-ping'
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

const DAppConnectionBanner = observer(() => {
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
        <div
          key={session.id}
          className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-xs"
        >
          <div className="flex items-center gap-2">
            <DAppPulsingDot status={session.status} />
            <span className="font-medium">{session.dappInfo.name}</span>
            <span className="text-muted-foreground">
              {statusLabels[session.status]}
            </span>
          </div>
          <button
            onClick={() => dappConnectStore.disconnectSession(session.id)}
            className="text-muted-foreground hover:text-destructive"
          >
            Disconnect
          </button>
        </div>
      ))}
    </div>
  );
});

export default DAppConnectionBanner;
