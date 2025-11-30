import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/UI/Card";
import { useStore } from "../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { ZOND_PROVIDER } from "../../../../../configuration/zondConfig";
import { CustomRpcModal } from "../../Home/ConnectionBadge/CustomRpcModal";
import { Button } from "@/components/UI/Button";
import { Network, Settings2 } from "lucide-react";
import { useState } from "react";

export const NetworkSettings = observer(() => {
    const { zondStore } = useStore();
    const { zondConnection, selectBlockchain } = zondStore;
    const { blockchain, isLoading } = zondConnection;
    const [isCustomRpcModalOpen, setIsCustomRpcModalOpen] = useState(false);
    const { TEST_NET, MAIN_NET, CUSTOM_RPC } = ZOND_PROVIDER;

    return (
        <Card className="border-l-4 border-l-blue-accent">
            <CardHeader className="bg-gradient-to-r from-blue-accent/5 to-transparent">
                <CardTitle className="text-2xl font-bold">Network Settings</CardTitle>
                <CardDescription>
                    Configure your network connections and RPC endpoints
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Button
                        variant={blockchain === MAIN_NET.id ? "secondary" : "outline"}
                        className="w-full justify-start"
                        onClick={() => selectBlockchain(MAIN_NET.id)}
                        disabled={isLoading}
                    >
                        <Settings2 className="mr-2 h-4 w-4" />
                        Mainnet
                    </Button>

                    <Button
                        variant={blockchain === TEST_NET.id ? "secondary" : "outline"}
                        className="w-full justify-start"
                        onClick={() => selectBlockchain(TEST_NET.id)}
                        disabled={isLoading}
                    >
                        <Settings2 className="mr-2 h-4 w-4" />
                        Testnet
                    </Button>

                    <Button
                        variant={blockchain === CUSTOM_RPC.id ? "secondary" : "outline"}
                        className="w-full justify-start"
                        onClick={() => setIsCustomRpcModalOpen(true)}
                        disabled={isLoading}
                    >
                        <Network className="mr-2 h-4 w-4" />
                        Custom RPC
                    </Button>
                </div>
            </CardContent>

            <CustomRpcModal
                isOpen={isCustomRpcModalOpen}
                onClose={() => setIsCustomRpcModalOpen(false)}
            />
        </Card>
    );
}); 