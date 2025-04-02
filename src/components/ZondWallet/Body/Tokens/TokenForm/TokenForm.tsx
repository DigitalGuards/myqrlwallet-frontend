import { TokenInterface } from "@/lib/constants";
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
import { fetchBalance } from "@/utilities/web3utils/customERC20";
import { useStore } from "@/stores/store";
import { Button } from "@/components/UI/Button";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { AddTokenModal } from "../AddTokenModal/AddTokenModal";
import { formatUnits } from "ethers";
import { ZOND_PROVIDER } from "@/configuration/zondConfig";
import StorageUtil from "@/utilities/storageUtil";
import { formatBalance } from "@/utilities/helper";

const TokenForm = observer(() => {
    const { zondStore } = useStore();
    const {
        activeAccount: { accountAddress: activeAccountAddress },
        tokenList: tokenListFromStore,
    } = zondStore;

    const [tokenList, setTokenList] = useState<TokenInterface[]>(tokenListFromStore);
    const [isAddTokenModalOpen, setIsAddTokenModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const refreshBalances = async () => {
        setIsRefreshing(true);
        await zondStore.refreshTokenBalances();
        setIsRefreshing(false);
    };

    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            let updatedTokenList = [...tokenListFromStore];

            const selectedBlockChain = await StorageUtil.getBlockChain();

            for (let i = 0; i < tokenListFromStore.length; i++) {
                const balance = await fetchBalance(tokenListFromStore[i].address, activeAccountAddress, ZOND_PROVIDER[selectedBlockChain].url);
                const formattedBalance = formatBalance(formatUnits(balance, tokenListFromStore[i].decimals));
                const decimalIndex = formattedBalance.indexOf('.');
                updatedTokenList[i].amount = decimalIndex === -1
                    ? formattedBalance
                    : formattedBalance.slice(0, decimalIndex + 5);
            }
            setTokenList(updatedTokenList);
            setIsLoading(false);
        };

        init();
    }, [activeAccountAddress, tokenListFromStore]);

    // Update local state when store changes
    useEffect(() => {
        setTokenList(tokenListFromStore);
    }, [tokenListFromStore]);

    return (
        <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Tokens</CardTitle>
                <div className="flex gap-2">
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={refreshBalances} 
                        disabled={isRefreshing}
                    >
                        {isRefreshing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="h-4 w-4" />
                        )}
                    </Button>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setIsAddTokenModalOpen(true)}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
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