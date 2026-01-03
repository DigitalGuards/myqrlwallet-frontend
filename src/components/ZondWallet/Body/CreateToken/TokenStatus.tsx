import { observer } from "mobx-react-lite";
import { useStore } from "@/stores/store";
import { useEffect, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/UI/Card";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import StringUtil from "@/utilities/stringUtil";
import { utils } from "@theqrl/web3";
import { Button } from "@/components/UI/Button";
import { ROUTES } from "@/router/router";
import { Link } from "react-router-dom";

const TokenStatus = observer(() => {
    const { zondStore } = useStore();
    const { addToken, createdToken, creatingToken } = zondStore;
    const { name, symbol, decimals, address, tx, blockNumber, blockHash, gasUsed, effectiveGasPrice } = createdToken;

    const [copiedItem, setCopiedItem] = useState<"txHash" | "tokenAddress" | "blockHash" | null>(null);

    const copyToClipboard = (text: string, type: "txHash" | "tokenAddress" | "blockHash") => {
        navigator.clipboard.writeText(text);
        setCopiedItem(type);
        setTimeout(() => {
            setCopiedItem(null);
        }, 1500);
    };


    useEffect(() => {
        const init = async () => {
            if (address) {
                await addToken({
                    name: name,
                    symbol: symbol,
                    decimals: decimals,
                    address: address,
                    amount: "0",
                });
            }
        }
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);


    return (
        <div className="w-full">
            <img
                className="fixed left-0 top-0 -z-10 h-96 w-96 -translate-x-8 scale-150 overflow-hidden opacity-10"
                src="/tree.svg"
                alt="Background Tree"
            />
            <div className="relative z-10 p-8">
                <Card className="w-full">
                    <CardHeader>
                        <CardTitle className="text-center">
                            {creatingToken.creating ? "Creating Token" : "Token Created"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-8">
                        {creatingToken.creating ? (
                            <div className="flex flex-col items-center">
                                <Loader2 className="animate-spin w-6 h-6 mb-2" />
                                <p>Creating token: {creatingToken.name}</p>
                                <p>Please wait...</p>
                            </div>
                        ) : (
                            <>

                                <div className="flex flex-col gap-2">
                                    <div>Transaction Hash</div>
                                    <div className="flex items-center gap-2">
                                        <a
                                            href={`https://zondscan.com/pending/tx/${tx}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-bold text-secondary hover:text-secondary/80"
                                        >
                                            {StringUtil.getSplitAddress(tx.toString())}
                                        </a>
                                        <a
                                            href={`https://zondscan.com/pending/tx/${tx}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-secondary hover:text-secondary/80"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                        <button
                                            onClick={() => copyToClipboard(tx.toString(), "txHash")}
                                            className="text-secondary hover:text-secondary/80"
                                        >
                                            {copiedItem === "txHash" ? (
                                                <Check className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <div>Token Address</div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-secondary">
                                            {StringUtil.getSplitAddress(address)}
                                        </span>
                                        <button
                                            onClick={() => copyToClipboard(address, "tokenAddress")}
                                            className="text-secondary hover:text-secondary/80"
                                        >
                                            {copiedItem === "tokenAddress" ? (
                                                <Check className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row sm:justify-start gap-4 sm:gap-10">
                                    <div className="flex flex-col gap-2">
                                        <div>Token Name</div>
                                        <div className="font-bold text-secondary break-words">
                                            {name}
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div>Token Symbol</div>
                                        <div className="font-bold text-secondary break-words">
                                            {symbol}
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div>Token Decimals</div>
                                        <div className="font-bold text-secondary">
                                            {decimals}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <div>Block hash</div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-secondary">
                                            {StringUtil.getSplitAddress(blockHash.toString())}
                                        </span>
                                        <button
                                            onClick={() => copyToClipboard(blockHash.toString(), "blockHash")}
                                            className="text-secondary hover:text-secondary/80"
                                        >
                                            {copiedItem === "blockHash" ? (
                                                <Check className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
                                    <div className="flex flex-col gap-2">
                                        <div>Block number</div>
                                        <a
                                            href={`https://zondscan.com/block/${blockNumber}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 font-bold text-secondary hover:text-secondary/80"
                                        >
                                            {blockNumber.toString()}
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div>Gas used</div>
                                        <div className="font-bold text-secondary break-all">
                                            {`${parseFloat(
                                                utils.fromWei(
                                                    BigInt(gasUsed) * BigInt(effectiveGasPrice ?? 0),
                                                    "ether"
                                                )
                                            )
                                                .toFixed(8)
                                                .replace(/\.?0+$/, "")} QRL`}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </CardContent>
                    {!creatingToken.creating &&
                        <CardFooter className="grid grid-cols-2 gap-4">
                            <span />
                            <Link className="w-full" to={ROUTES.HOME}>
                                <Button className="w-full" type="button">
                                    <Check className="mr-2 h-4 w-4" />
                                    Done
                                </Button>
                            </Link>
                        </CardFooter>
                    }
                </Card>
            </div>
        </div>
    );
});

export default TokenStatus; 