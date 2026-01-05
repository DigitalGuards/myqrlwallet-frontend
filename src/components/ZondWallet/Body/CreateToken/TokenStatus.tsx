import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { useEffect } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/UI/Card";
import { Check, Copy, ExternalLink, Loader2, Sparkles, XCircle } from "lucide-react";
import { StringUtil } from "@/utils/formatting";
import { utils } from "@theqrl/web3";
import { BigNumber } from "bignumber.js";
import { Button } from "@/components/UI/Button";
import { ROUTES } from "@/router/router";
import { Link } from "react-router-dom";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { ZOND_PROVIDER } from "@/config";

const TokenStatus = observer(() => {
    const { zondStore } = useStore();
    const { addToken, createdToken, creatingToken, zondConnection } = zondStore;
    const { name, symbol, decimals, address, tx, blockNumber, blockHash, gasUsed, effectiveGasPrice } = createdToken;
    const explorerUrl = ZOND_PROVIDER[zondConnection.blockchain as keyof typeof ZOND_PROVIDER]?.explorer || "https://zondscan.com";

    const { copiedItem, copyToClipboard } = useCopyToClipboard<"txHash" | "tokenAddress" | "blockHash">();

    const gasInQrl = new BigNumber(
        utils.fromWei(BigInt(gasUsed) * BigInt(effectiveGasPrice ?? 0), "ether")
    )
        .dp(8, BigNumber.ROUND_DOWN)
        .toString()
        .replace(/\.?0+$/, "");

    useEffect(() => {
        const addCreatedToken = async () => {
            if (address) {
                try {
                    await addToken({
                        name,
                        symbol,
                        decimals,
                        address,
                        amount: "0",
                    });
                } catch (error) {
                    console.error("Failed to add token to list:", error);
                }
            }
        };
        addCreatedToken();
    }, [address, addToken, name, symbol, decimals]);

    // Determine which state to show
    const isCreating = creatingToken.creating;
    const hasError = !creatingToken.creating && creatingToken.error;
    const isSuccess = !creatingToken.creating && !creatingToken.error && address;

    return (
        <div className="flex w-full items-start justify-center py-8 overflow-x-hidden">
            <div className="relative w-full max-w-2xl px-4">
                <img
                    className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
                    src="/tree.svg"
                    alt="Background Tree"
                />

                {/* Creating State */}
                {isCreating && (
                    <Card className="w-full border-l-4 border-l-orange-500">
                        <CardHeader className="bg-gradient-to-r from-orange-500/10 to-transparent">
                            <CardTitle className="flex items-center gap-2">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                Creating Token
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="py-12">
                            <div className="flex flex-col items-center gap-4 text-center">
                                <div className="relative">
                                    <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/20" />
                                    <div className="relative rounded-full bg-orange-500/10 p-6">
                                        <Sparkles className="h-8 w-8 text-orange-500" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-lg font-medium">{creatingToken.name}</p>
                                    <p className="text-sm text-muted-foreground">
                                        Deploying your token to the blockchain...
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Error State */}
                {hasError && (
                    <Card className="w-full border-l-4 border-l-destructive">
                        <CardHeader className="bg-gradient-to-r from-destructive/10 to-transparent">
                            <CardTitle className="flex items-center gap-2">
                                <XCircle className="h-5 w-5 text-destructive" />
                                Token Creation Failed
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="py-8">
                            <div className="flex flex-col items-center gap-4 text-center">
                                <div className="rounded-full bg-destructive/10 p-6">
                                    <XCircle className="h-8 w-8 text-destructive" />
                                </div>
                                <div className="space-y-2">
                                    <p className="text-lg font-medium">Something went wrong</p>
                                    <p className="text-sm text-muted-foreground max-w-md">
                                        {creatingToken.error}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Link className="w-full" to={ROUTES.CREATE_TOKEN}>
                                <Button className="w-full" type="button" variant="outline">
                                    Try Again
                                </Button>
                            </Link>
                        </CardFooter>
                    </Card>
                )}

                {/* Success State */}
                {isSuccess && (
                    <Card className="w-full border-l-4 border-l-green-500">
                        <CardHeader className="bg-gradient-to-r from-green-500/10 to-transparent">
                            <CardTitle className="flex items-center gap-2">
                                <Check className="h-5 w-5 text-green-500" />
                                Token Created
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex flex-col gap-1">
                                <span className="text-sm text-muted-foreground">Transaction Hash</span>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={`${explorerUrl}/tx/${tx}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 font-medium text-secondary hover:text-secondary/80"
                                    >
                                        {StringUtil.getSplitAddress(tx.toString())}
                                        <ExternalLink className="h-4 w-4" />
                                    </a>
                                    <button
                                        onClick={() => copyToClipboard(tx.toString(), "txHash")}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        {copiedItem === "txHash" ? (
                                            <Check className="h-4 w-4 text-green-500" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-sm text-muted-foreground">Token Address</span>
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-secondary">
                                        {StringUtil.getSplitAddress(address)}
                                    </span>
                                    <button
                                        onClick={() => copyToClipboard(address, "tokenAddress")}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        {copiedItem === "tokenAddress" ? (
                                            <Check className="h-4 w-4 text-green-500" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm text-muted-foreground">Name</span>
                                    <span className="font-medium text-secondary break-words">{name}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm text-muted-foreground">Symbol</span>
                                    <span className="font-medium text-secondary break-words">{symbol}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm text-muted-foreground">Decimals</span>
                                    <span className="font-medium text-secondary">{decimals}</span>
                                </div>
                            </div>

                            <div className="flex flex-col gap-1">
                                <span className="text-sm text-muted-foreground">Block Hash</span>
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-secondary">
                                        {StringUtil.getSplitAddress(blockHash.toString())}
                                    </span>
                                    <button
                                        onClick={() => copyToClipboard(blockHash.toString(), "blockHash")}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        {copiedItem === "blockHash" ? (
                                            <Check className="h-4 w-4 text-green-500" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm text-muted-foreground">Block Number</span>
                                    <a
                                        href={`${explorerUrl}/block/${blockNumber}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 font-medium text-secondary hover:text-secondary/80"
                                    >
                                        {blockNumber.toString()}
                                        <ExternalLink className="h-4 w-4" />
                                    </a>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <span className="text-sm text-muted-foreground">Gas Used</span>
                                    <span className="font-medium text-secondary">{gasInQrl} QRL</span>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Link className="w-full" to={ROUTES.HOME}>
                                <Button className="w-full" type="button">
                                    <Check className="mr-2 h-4 w-4" />
                                    Done
                                </Button>
                            </Link>
                        </CardFooter>
                    </Card>
                )}
            </div>
        </div>
    );
});

export default TokenStatus;
