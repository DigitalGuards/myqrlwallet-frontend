import { useState, useEffect } from "react";
import { observer } from "mobx-react-lite";
import axios from "axios";
import { SERVER_URL } from "@/configuration/zondConfig";
import { formatBalance } from "@/utilities/helper";
import { Card, CardContent } from "../../../../UI/Card";
import { Button } from "../../../../UI/Button";
import { getExplorerAddressUrl } from "../../../../../configuration/zondConfig";

type TransactionHistoryType = {
    ID: string;
    InOut: number;
    TxType: string;
    Address: string;
    From: string;
    To: string;
    TxHash: string;
    TimeStamp: string;
    Amount: string;
    PaidFees: string;
    BlockNumber: string;
}

interface TransactionHistoryPopupProps {
    accountAddress: string;
    blockchain: string;
    isOpen: boolean;
    onClose: () => void;
}

export const TransactionHistoryPopup = observer(({ 
    accountAddress, 
    blockchain,
    isOpen,
    onClose
}: TransactionHistoryPopupProps) => {
    const [transactions, setTransactions] = useState<TransactionHistoryType[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && accountAddress) {
            fetchTransactionHistory(accountAddress);
        }
    }, [isOpen, accountAddress]);

    const fetchTransactionHistory = async (address: string) => {
        setLoading(true);
        try {
            const response = await axios.post(`${SERVER_URL}/tx-history`, {
                address: address,
                page: 1,
                limit: 5
            });
            setTransactions(response.data.transactions || []);
        } catch (error) {
            console.error("Failed to fetch transaction history:", error);
        }
        setLoading(false);
    };

    const viewAllTransactions = () => {
        window.open(getExplorerAddressUrl(accountAddress, blockchain), '_blank');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <Card className="w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <CardContent className="p-4">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold">Recent Transactions</h2>
                        <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
                    </div>
                    
                    {loading ? (
                        <div className="text-center py-8">Loading...</div>
                    ) : transactions.length === 0 ? (
                        <div className="text-center py-8">No transactions found</div>
                    ) : (
                        <div className="space-y-3">
                            {transactions.map((tx) => (
                                <div key={tx.ID} className="border-b border-border pb-3">
                                    <div className="flex justify-between">
                                        <span className="font-medium">
                                            {tx.TxType}
                                        </span>
                                        <span className={tx.InOut === 1 ? "text-green-500" : "text-red-500"}>
                                            {tx.InOut === 1 ? "+" : "-"}{formatBalance(tx.Amount)} QRL
                                        </span>
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        <div className="truncate">
                                            Hash: {tx.TxHash.substring(0, 16)}...
                                        </div>
                                        <div>
                                            Date: {new Date(parseInt(tx.TimeStamp, 16) * 1000).toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    <div className="mt-4 flex justify-center">
                        <Button variant="outline" onClick={viewAllTransactions}>
                            View All in Explorer
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
});
