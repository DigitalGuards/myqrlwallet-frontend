/**
 * DApp Connection Banner - Shows active dApp connections status.
 * Displays as a persistent indicator at the top of the wallet.
 */

import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/store';
import { SessionStatus } from '@/services/dappConnect/types';

const statusColors: Record<SessionStatus, string> = {
  [SessionStatus.CONNECTED]: 'bg-green-500',
  [SessionStatus.RECONNECTING]: 'bg-yellow-500',
  [SessionStatus.CONNECTING]: 'bg-yellow-500',
  [SessionStatus.KEY_EXCHANGE]: 'bg-yellow-500',
  [SessionStatus.DISCONNECTED]: 'bg-red-500',
};

const statusLabels: Record<SessionStatus, string> = {
  [SessionStatus.CONNECTED]: 'Connected',
  [SessionStatus.RECONNECTING]: 'Reconnecting...',
  [SessionStatus.CONNECTING]: 'Connecting...',
  [SessionStatus.KEY_EXCHANGE]: 'Exchanging keys...',
  [SessionStatus.DISCONNECTED]: 'Disconnected',
};

const DAppConnectionBanner = observer(() => {
  const { dappConnectStore } = useStore();
  const { activeSessions } = dappConnectStore;

  if (activeSessions.length === 0) return null;

  return (
    <div className="space-y-1 px-4 pb-2">
      {activeSessions.map((session) => (
        <div
          key={session.id}
          className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-xs"
        >
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${statusColors[session.status]}`} />
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
