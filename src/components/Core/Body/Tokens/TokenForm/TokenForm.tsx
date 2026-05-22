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
import { Check, Plus, RefreshCw, Import, Coins, Sparkles } from "lucide-react";
import { AddTokenModal } from "../AddTokenModal/AddTokenModal";
import { formatUnits } from "ethers";
import { QRL_PROVIDER } from "@/config";
import { StorageUtil } from "@/utils/storage";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/UI/DropdownMenu";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/UI/Tooltip";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { getOptimalTokenBalance } from "@/utils/formatting";

const TokenForm = observer(() => {
    const { qrlStore, tokenStore } = useStore();
    const navigate = useNavigate();
    const { accountAddress: activeAccountAddress } = qrlStore.activeAccount;
    const { visibleTokenList, pendingDiscoveredTokens } = tokenStore;

    const [tokenList, setTokenList] = useState<TokenInterface[]>(visibleTokenList);
    const [isAddTokenModalOpen, setIsAddTokenModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshSuccess, setRefreshSuccess] = useState(false);

    // Refresh balances of the tokens already in the user's list. Does NOT
    // re-discover from the explorer — that would re-introduce the spam
    // vector the gate (PR #142) closes. To find tokens the explorer sees
    // but the user hasn't added, open "Add Existing Token" — the modal
    // surfaces a picker built from pendingDiscoveredTokens.
    const refreshTokens = async () => {
        setIsRefreshing(true);
        try {
            await tokenStore.refreshTokenBalances();
        } catch (error) {
            console.error("Failed to refresh tokens:", error);
        } finally {
            setIsRefreshing(false);
            setRefreshSuccess(true);
            setTimeout(() => setRefreshSuccess(false), 1500);
        }
    };

    // Populate the discovery cache so the empty-state ("Explorer found N
    // tokens") and the AddTokenModal picker have data without any user
    // gesture. The result lands in tokenStore.discoveredTokens, NOT
    // tokenList — adding to the live list still requires an explicit
    // pick.
    useEffect(() => {
        if (!activeAccountAddress) return;
        void tokenStore.discoverTokensForReview(activeAccountAddress);
    }, [activeAccountAddress, tokenStore]);

    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                const selectedBlockChain = await StorageUtil.getBlockChain();
                const promises = visibleTokenList.map(async (token) => {
                    try {
                        const balance = await fetchBalance(token.address, activeAccountAddress, QRL_PROVIDER[selectedBlockChain].url);
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
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={refreshTokens}
                                    disabled={isRefreshing || refreshSuccess}
                                >
                                    {refreshSuccess ? (
                                        <Check className="h-4 w-4 text-green-500" />
                                    ) : isRefreshing ? (
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Refresh balances of imported tokens</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
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
                <DataTable
                    columns={columns}
                    data={tokenList}
                    isLoading={isLoading}
                    emptyMessage={
                        pendingDiscoveredTokens.length > 0 ? (
                            <div className="flex flex-col items-center gap-2 py-2">
                                <div className="flex items-center gap-2 text-sm">
                                    <Sparkles className="h-4 w-4 text-muted-foreground/70" />
                                    Explorer found this address to own{" "}
                                    <span className="font-medium">
                                        {pendingDiscoveredTokens.length}
                                    </span>{" "}
                                    token
                                    {pendingDiscoveredTokens.length === 1 ? "" : "s"}.
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setIsAddTokenModalOpen(true)}
                                >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Review and add
                                </Button>
                            </div>
                        ) : undefined
                    }
                />
            </CardContent>
            <AddTokenModal isOpen={isAddTokenModalOpen} onClose={() => setIsAddTokenModalOpen(false)} />
        </Card>
    );
});

export default TokenForm;
