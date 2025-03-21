import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { Loader2 } from "lucide-react";

const TokenStatus = observer(() => {
    const { zondStore } = useStore();
    const { createdToken, creatingToken } = zondStore;
    const { name, symbol, decimals, address } = createdToken;

    useEffect(() => {
        // You can add logic here to fetch or update the status if needed
    }, []);

    return (
        <div className="flex w-full items-center justify-center py-8">
            <Card className="max-w-md w-full">
                <CardHeader>
                    <CardTitle className="text-center">
                        {creatingToken.creating ? "Creating Token" : "Token Created"}
                    </CardTitle>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                    {creatingToken.creating ? (
                        <div className="flex flex-col items-center">
                            <Loader2 className="animate-spin w-6 h-6 mb-2" />
                            <p>Creating token: {creatingToken.name}</p>
                            <p>Please wait...</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p><strong>Token Name:</strong> {name}</p>
                            <p><strong>Token Symbol:</strong> {symbol}</p>
                            <p><strong>Token Decimals:</strong> {decimals}</p>
                            <p><strong>Token Address:</strong> {address}</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
});

export default TokenStatus; 