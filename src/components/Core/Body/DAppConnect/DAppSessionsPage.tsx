import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["dapps", "common", "settings", "transfer"]);
  const { dappConnectStore } = useStore();
  return (
    <PageShell
      title={t("dapps:sessionsTitle")}
      subtitle={t("dapps:sessionsSubtitle")}
      width="wide"
      seoTitle={t("dapps:sessionsSeo")}
      action={
        dappConnectStore.activeSessions.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              dappConnectStore.disconnectAll();
            }}
          >
            {t("settings:disconnectAll")}
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
