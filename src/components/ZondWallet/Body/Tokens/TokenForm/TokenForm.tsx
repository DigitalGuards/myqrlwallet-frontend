import { TokenInterface } from "@/constants";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "../../../../UI/Card";
import { observer } from "mobx-react-lite";
import { columns } from "./columns"
import { DataTable } from "./data-table"
import { useEffect, useState } from "react";
import { fetchBalance } from "@/utils/web3";
import { useStore } from "@/stores/store";
import { Button } from "@/components/UI/Button";
import { Loader2, Plus, RefreshCw, Import, Coins } from "lucide-react";
import { AddTokenModal } from "../AddTokenModal/AddTokenModal";
import { formatUnits } from "ethers";
import { ZOND_PROVIDER } from "@/config";
import { StorageUtil } from "@/utils/storage";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/UI/DropdownMenu";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { getOptimalTokenBalance } from "@/utils/formatting";

const TokenForm = observer(() => {
    const { zondStore } = useStore();
    const navigate = useNavigate();
    const {
        activeAccount: { accountAddress: activeAccountAddress },
        visibleTokenList,
    } = zondStore;

    const [tokenList, setTokenList] = useState<TokenInterface[]>(visibleTokenList);
    const [isAddTokenModalOpen, setIsAddTokenModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const refreshTokens = async () => {
        setIsRefreshing(true);
        try {
            // Discover new tokens first
            await zondStore.discoverAndAddTokens(activeAccountAddress);

            // Then refresh all balances
            await zondStore.refreshTokenBalances();
        } catch (error) {
            console.error("Failed to refresh tokens:", error);
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                const selectedBlockChain = await StorageUtil.getBlockChain();
                const promises = visibleTokenList.map(async (token) => {
                    try {
                        const balance = await fetchBalance(token.address, activeAccountAddress, ZOND_PROVIDER[selectedBlockChain].url);
                        const balanceStr = formatUnits(balance, token.decimals);
                        return { ...token, amount: getOptimalTokenBalance(balanceStr, token.symbol) };
                    } catch (err) {
                        console.error(`Failed to fetch balance for token ${token.symbol}:`, err);
                        return { ...token, amount: "Error" };
                    }
                });
                const updatedTokenList = await Promise.all(promises);
                setTokenList(updatedTokenList);
            } catch (err) {
                console.error("Failed to initialize token list:", err);
            } finally {
                setIsLoading(false);
            }
        };

        init();
    }, [activeAccountAddress, visibleTokenList]);

    // Update local state when store changes
    useEffect(() => {
        setTokenList(visibleTokenList);
    }, [visibleTokenList]);

    return (
        <Card className="border-l-4 border-l-secondary">
            <CardHeader className="flex flex-row items-center justify-between bg-gradient-to-r from-secondary/5 to-transparent">
                <CardTitle className="text-2xl font-bold">Tokens</CardTitle>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={refreshTokens}
                        disabled={isRefreshing}
                    >
                        {isRefreshing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="h-4 w-4" />
                        )}
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <Plus className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setIsAddTokenModalOpen(true)}>
                                <Import className="mr-2 h-4 w-4" />
                                Add Existing Token
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(ROUTES.CREATE_TOKEN)}>
                                <Coins className="mr-2 h-4 w-4" />
                                Create New Token
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent>
                <DataTable columns={columns} data={tokenList} isLoading={isLoading} />
            </CardContent>
            <AddTokenModal isOpen={isAddTokenModalOpen} onClose={() => setIsAddTokenModalOpen(false)} />
        </Card>
    );
});

export default TokenForm;