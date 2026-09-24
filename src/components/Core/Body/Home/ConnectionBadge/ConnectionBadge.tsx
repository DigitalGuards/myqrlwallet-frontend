import { Link } from "react-router";
import { observer } from "mobx-react-lite";
import { AVAILABLE_NETWORKS } from "@/config";
import { useStore } from "../../../../../stores/store";
import { ROUTES } from "@/router/router";

// Short, tab-width network name for the plain status label. The v3 profile
// exposes exactly one network (testnet v3), so it reads the same "TESTNET"
// as the default profile's testnet.
function shortNetworkLabel(blockchain: string): string {
  return blockchain === "MAIN_NET" ? "MAINNET" : "TESTNET";
}

// Connection state as a plain word, appended to the network name. No word
// means "connected", the quiet default.
function connectionSuffix(isConnected: boolean, isLoading: boolean): string | null {
  if (isLoading) return "CONNECTING";
  if (!isConnected) return "OFFLINE";
  return null;
}

// A muted, static status label. It replaces the old pill dropdown: network
// switching now lives entirely in Settings > Network. The label links there
// only when a second network is actually configured, since the v3 profile
// has nothing to switch to.
const ConnectionBadge = observer(() => {
  const { qrlStore } = useStore();
  const { qrlConnection } = qrlStore;
  const { isConnected, isLoading, blockchain, qrlNetworkName } = qrlConnection;

  const network = shortNetworkLabel(blockchain);
  const suffix = connectionSuffix(isConnected, isLoading);
  const label = suffix ? `${network} · ${suffix}` : network;
  const canSwitchNetwork = AVAILABLE_NETWORKS.length > 1;

  const text = (
    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.2em]">
      {label}
    </span>
  );

  if (!canSwitchNetwork) {
    return (
      <span
        className="text-muted-foreground"
        aria-label={`Network: ${qrlNetworkName}`}
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
      aria-label={`Network: ${qrlNetworkName}. Change network in Settings.`}
      title={qrlNetworkName}
    >
      {text}
    </Link>
  );
});

export default ConnectionBadge;
