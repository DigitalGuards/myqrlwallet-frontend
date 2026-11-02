import { networkName } from "@/i18n/networkName";
import { useTranslation } from "react-i18next";
import { useStore } from "../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { AVAILABLE_NETWORKS, IS_V3_PROFILE } from "@/config";
import { MAINNET_V3_ID } from "@/config/deploymentProfile";
import { Check, FlaskConical, Globe } from "lucide-react";
import { SettingsRow, SettingsSection } from "../SettingsList";
import { logger } from "@/utils/log";

const isMainnet = (id: string) => id === "MAIN_NET" || id === MAINNET_V3_ID;

export const NetworkSettings = observer(() => {
  const { t } = useTranslation(["settings", "common"]);
  const { t: common } = useTranslation("common");
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const selectBlockchain = qrlStore.selectBlockchain.bind(qrlStore);
  const { blockchain, isLoading } = qrlConnection;
  const networks = [...AVAILABLE_NETWORKS].sort(
    (left, right) =>
      Number(isMainnet(right.id)) - Number(isMainnet(left.id)),
  );

  const activeMark = <Check className="h-4 w-4 shrink-0 text-primary" />;

  return (
    <SettingsSection title={t("settings:network")}>
      {networks.map((network) => (
        <SettingsRow
          key={network.id}
          icon={isMainnet(network.id) ? Globe : FlaskConical}
          tint={
            isMainnet(network.id)
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-amber-500/15 text-amber-400"
          }
          title={
            IS_V3_PROFILE
              ? networkName(network.name, common)
              : network.id === "MAIN_NET"
                ? t("common:mainnet")
                : t("common:testnet")
          }
          right={blockchain === network.id ? activeMark : undefined}
          onClick={() => {
            void Promise.resolve(selectBlockchain(network.id)).catch(
              (error: unknown) => {
                logger.error("Failed to select network:", error);
              },
            );
          }}
          disabled={isLoading}
        />
      ))}
    </SettingsSection>
  );
});
