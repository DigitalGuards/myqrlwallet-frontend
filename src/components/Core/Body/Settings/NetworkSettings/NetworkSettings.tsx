import { useStore } from "../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { AVAILABLE_NETWORKS, IS_V3_PROFILE } from "@/config";
import { Check, FlaskConical, Globe } from "lucide-react";
import { SettingsRow, SettingsSection } from "../SettingsList";

export const NetworkSettings = observer(() => {
    const { qrlStore } = useStore();
    const { qrlConnection, selectBlockchain } = qrlStore;
    const { blockchain, isLoading } = qrlConnection;
    const networks = [...AVAILABLE_NETWORKS].sort(
        (left, right) => Number(right.id === "MAIN_NET") - Number(left.id === "MAIN_NET"),
    );

    const activeMark = <Check className="h-4 w-4 shrink-0 text-primary" />;

    return (
        <SettingsSection title="Network">
            {networks.map((network) => (
                <SettingsRow
                    key={network.id}
                    icon={network.id === "MAIN_NET" ? Globe : FlaskConical}
                    tint={network.id === "MAIN_NET"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400"}
                    title={IS_V3_PROFILE ? network.name : network.id === "MAIN_NET" ? "Mainnet" : "Testnet"}
                    right={blockchain === network.id ? activeMark : undefined}
                    onClick={() => selectBlockchain(network.id)}
                    disabled={isLoading}
                />
            ))}
        </SettingsSection>
    );
});
