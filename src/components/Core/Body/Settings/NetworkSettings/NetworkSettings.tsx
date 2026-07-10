import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/UI/Card";
import { useStore } from "../../../../../stores/store";
import { observer } from "mobx-react-lite";
import { QRL_PROVIDER } from "@/config";
import { Button } from "@/components/UI/Button";
import { Settings2 } from "lucide-react";

export const NetworkSettings = observer(() => {
    const { qrlStore } = useStore();
    const { qrlConnection, selectBlockchain } = qrlStore;
    const { blockchain, isLoading } = qrlConnection;
    const { TEST_NET, MAIN_NET } = QRL_PROVIDER;

    return (
        <Card >
            <CardHeader>
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
                </div>
            </CardContent>
        </Card>
    );
});
