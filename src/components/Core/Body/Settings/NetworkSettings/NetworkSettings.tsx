import { useStore } from "../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { QRL_PROVIDER } from "@/config";
import { Check, FlaskConical, Globe } from "lucide-react";
import { SettingsRow, SettingsSection } from "../SettingsList";

export const NetworkSettings = observer(() => {
    const { qrlStore } = useStore();
    const { qrlConnection, selectBlockchain } = qrlStore;
    const { blockchain, isLoading } = qrlConnection;
    const { TEST_NET, MAIN_NET } = QRL_PROVIDER;

    const activeMark = <Check className="h-4 w-4 shrink-0 text-primary" />;

    return (
        <SettingsSection title="Network">
            <SettingsRow
                icon={Globe}
                tint="bg-emerald-500/15 text-emerald-400"
                title="Mainnet"
                right={blockchain === MAIN_NET.id ? activeMark : undefined}
                onClick={() => selectBlockchain(MAIN_NET.id)}
                disabled={isLoading}
            />
            <SettingsRow
                icon={FlaskConical}
                tint="bg-amber-500/15 text-amber-400"
                title="Testnet"
                right={blockchain === TEST_NET.id ? activeMark : undefined}
                onClick={() => selectBlockchain(TEST_NET.id)}
                disabled={isLoading}
            />
        </SettingsSection>
    );
});
