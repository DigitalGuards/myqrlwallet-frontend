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

export const TokenForm = observer(() => {
    const { zondStore } = useStore();
    const {
        activeAccount: { accountAddress: activeAccountAddress },
    } = zondStore;

    const [data, setData] = useState<TokenInterface[]>(KNOWN_TOKEN_LIST);
    useEffect(() => {
        const init = async () => {
            for (let i = 0; i < KNOWN_TOKEN_LIST.length; i++) {
                console.log(KNOWN_TOKEN_LIST[i].address, activeAccountAddress)
                const balance = await fetchBalance(KNOWN_TOKEN_LIST[i].address, activeAccountAddress)
                setData((prevData) => {
                    let tempData = [...prevData];
                    tempData[i].amount = `${balance}`;
                    return tempData
                })
            }
        }
        init()
    }, [activeAccountAddress])
    return (
        <Card>
            <CardHeader>
                <CardTitle>Tokens</CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
                <DataTable columns={columns} data={data} />
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
