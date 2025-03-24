import { observer } from "mobx-react-lite";
import { useStore } from "../../../../stores/store";
import { useEffect, useState } from "react";
import axios from "axios";
import { SERVER_URL } from "@/configuration/zondConfig";

type TransactionHistoryType = {
    hash: string;
    amount: string;
    timestamp: string;
}

const TransactionHistory = observer(() => {
    const { zondStore } = useStore();
    const { activeAccount } = zondStore;
    const [transactionHistory, setTransactionHistory] = useState<TransactionHistoryType[]>([]);

    const fetchTransactionHistory = async (accountAddress: string) => {
        const transactionHistory = await axios.post(`${SERVER_URL}/tx-history`, {
            accountAddress: accountAddress
        });
        setTransactionHistory(transactionHistory.data);
    }

    useEffect(() => {
        const init = async () => {
            if (activeAccount.accountAddress) {
                await fetchTransactionHistory(activeAccount.accountAddress);
            }
        }
        init();
    }, [activeAccount.accountAddress, fetchTransactionHistory]);

    return (
        <div className="p-4">
            <h1 className="text-xl font-bold">Transaction History</h1>
            <ul>
                {transactionHistory.map((tx, index) => (
                    <li key={index} className="border-b py-2">
                        <div>Hash: {tx.hash}</div>
                        <div>Amount: {tx.amount} QRL</div>
                        <div>Date: {new Date(tx.timestamp).toLocaleString()}</div>
                    </li>
                ))}
            </ul>
        </div>
    );
});

export default TransactionHistory; 