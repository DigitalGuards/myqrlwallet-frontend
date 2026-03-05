/**
 * DApp Sessions List - Management page for active dApp connections.
 * Accessible from Settings.
 */

import { observer } from 'mobx-react-lite';
import { useStore } from '@/stores/store';
import { Button } from '@/components/UI/Button';
import { SessionStatus } from '@/services/dappConnect/types';

const statusColors: Record<SessionStatus, string> = {
  [SessionStatus.CONNECTED]: 'text-green-500',
  [SessionStatus.RECONNECTING]: 'text-yellow-500',
  [SessionStatus.CONNECTING]: 'text-yellow-500',
  [SessionStatus.KEY_EXCHANGE]: 'text-yellow-500',
  [SessionStatus.DISCONNECTED]: 'text-red-500',
};

const DAppSessionsList = observer(() => {
  const { dappConnectStore } = useStore();
  const { activeSessions } = dappConnectStore;

  return (
    <div className="space-y-4 p-4">
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
                  <span className="font-semibold">{session.dappInfo.name}</span>
                  <span className={`text-xs ${statusColors[session.status]}`}>
                    {session.status}
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
