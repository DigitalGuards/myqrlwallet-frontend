import { TokenInterface } from "@/lib/constants";
import {
    Card,
    CardContent,
    CardFooter,
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
import { Plus } from "lucide-react";
import { AddTokenModal } from "../AddTokenModal/AddTokenModal";

export const TokenForm = observer(() => {
    const { zondStore } = useStore();
    const {
        activeAccount: { accountAddress: activeAccountAddress },
        tokenList: tokenListFromStore,
    } = zondStore;

    const [tokenList, setTokenList] = useState<TokenInterface[]>(tokenListFromStore);
    const [isAddTokenModalOpen, setIsAddTokenModalOpen] = useState(false);

    useEffect(() => {
        const init = async () => {
            let updatedTokenList = [...tokenListFromStore];

            for (let i = 0; i < tokenListFromStore.length; i++) {
                const balance = await fetchBalance(tokenListFromStore[i].address, activeAccountAddress);
                updatedTokenList[i].amount = `${parseInt(balance.toString()) / 10 ** tokenListFromStore[i].decimals}`;
            }
            setTokenList(updatedTokenList);
        };

        init();
    }, [activeAccountAddress, tokenListFromStore]);

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle>
                        Tokens
                    </CardTitle>
                    <Button className="bg-primary text-primary-foreground p-2 hover:bg-primary/80" onClick={() => setIsAddTokenModalOpen(true)}>
                        <Plus />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-8">
                <DataTable columns={columns} data={tokenList} />
            </CardContent>
            <CardFooter>
            </CardFooter>
            <AddTokenModal isOpen={isAddTokenModalOpen} onClose={() => setIsAddTokenModalOpen(false)} />
        </Card>
    );
}
);
