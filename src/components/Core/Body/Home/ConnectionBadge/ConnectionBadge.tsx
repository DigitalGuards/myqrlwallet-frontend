import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { observer } from "mobx-react-lite";
import { AVAILABLE_NETWORKS } from "@/config";
import { useStore } from "@/stores/store";
import { ROUTES } from "@/router/router";

const ConnectionBadge = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { isConnected, isLoading, blockchain, qrlNetworkName } =
    qrlStore.qrlConnection;
  const network = blockchain === "MAIN_NET" ? t("mainnet") : "Testnet";
  const label = isLoading
    ? t("networkConnecting", { network })
    : !isConnected
      ? t("networkOffline", { network })
      : network;
  const text = (
    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.2em]">
      {label}
    </span>
  );
  if (AVAILABLE_NETWORKS.length <= 1) {
    return (
      <span
        className="text-muted-foreground"
        aria-label={t("network", { network: qrlNetworkName })}
        title={qrlNetworkName}
      >
        {text}
      </span>
    );
  }
  return (
    <Link
      to={ROUTES.SETTINGS}
      className="text-muted-foreground transition-colors hover:text-foreground"
      aria-label={t("changeNetwork", { network: qrlNetworkName })}
      title={qrlNetworkName}
    >
      {text}
    </Link>
  );
});
export default ConnectionBadge;
