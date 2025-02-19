import { KNOWN_TOKEN_LIST, TokenInterface } from "@/lib/constants";
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
import StorageUtil from "@/utilities/storageUtil";

export const TokenForm = observer(() => {
    const { zondStore } = useStore();
    const {
        activeAccount: { accountAddress: activeAccountAddress },
    } = zondStore;

    const [tokenList, setTokenList] = useState<TokenInterface[]>([]);

    useEffect(() => {
        const init = async () => {
            for (let i = 0; i < KNOWN_TOKEN_LIST.length; i++) {
                const balance = await fetchBalance(KNOWN_TOKEN_LIST[i].address, activeAccountAddress)
                setTokenList((prevTokenList) => {
                    let tempTokenList = [...prevTokenList];
                    tempTokenList[i].amount = `${parseInt(balance.toString()) / 10 ** KNOWN_TOKEN_LIST[i].decimals}`;
                    return tempTokenList
                })
            }
        }
        init()
    }, [activeAccountAddress])

    useEffect(() => {
        const init = async () => {
            const tokenListFromStorage = await StorageUtil.getTokenList();
            setTokenList(tokenListFromStorage);
        }
        init()
    }, [])

    return (
        <Card>
            <CardHeader>
                <CardTitle>Tokens</CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
                <DataTable columns={columns} data={tokenList} />
                {/* {KNOWN_TOKEN_LIST.map((token) => {
                    return <>{token.symbol}</>
                })} */}
            </CardContent>
            <CardFooter>
            </CardFooter>
        </Card>
    );
}
);
