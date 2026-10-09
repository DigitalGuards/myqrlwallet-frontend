/**
 * Standalone /dapp-sessions route: where web fragment-link handoffs land and
 * the consent modal navigates after a successful connect. Settings embeds
 * the same list in its own card.
 */

import { Card } from "@/components/UI/Card";
import DAppSessionsList from "./DAppSessionsList";
import { observer } from "mobx-react-lite";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { Button } from "@/components/UI/Button";
import { useStore } from "@/stores/store";

const DAppSessionsPage = observer(() => {
  const { dappConnectStore } = useStore();
  return (
    <PageShell
      title="dApp connections"
      subtitle="dApps paired with this wallet over the end-to-end encrypted QRL Connect relay."
      width="wide"
      seoTitle="dApp Connections"
      action={
        dappConnectStore.activeSessions.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              dappConnectStore.disconnectAll();
            }}
          >
            Disconnect all
          </Button>
        )
      }
    >
      <Card>
        <DAppSessionsList showHeading={false} />
      </Card>
    </PageShell>
  );
});

export default DAppSessionsPage;
