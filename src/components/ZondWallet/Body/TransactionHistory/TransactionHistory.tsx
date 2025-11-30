import { observer } from "mobx-react-lite";
import { useStore } from "../../../../stores/store";
import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { SERVER_URL } from "@/configuration/zondConfig";
import { formatBalance } from "@/utilities/helper";

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

const TransactionHistory = observer(() => {
    const { zondStore } = useStore();
    const { activeAccount } = zondStore;
    const [transactionHistory, setTransactionHistory] = useState<TransactionHistoryType[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: keyof TransactionHistoryType, direction: 'ascending' | 'descending' } | null>(null);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [hasMore, setHasMore] = useState<boolean>(true);

    const limit = 5;

    const fetchTransactionHistory = async (accountAddress: string, page: number, reset: boolean = false) => {
        setLoading(true);
        try {
            const response = await axios.post(`${SERVER_URL}/tx-history`, {
                address: accountAddress,
                page: page,
                limit: limit,
                searchTerm: searchTerm,
                sortKey: sortConfig?.key,
                sortDirection: sortConfig?.direction,
            });
            const newTransactions: TransactionHistoryType[] = response.data.transactions;

            if (newTransactions.length === 0) {
                setHasMore(false);
            }

            if (reset) {
                setTransactionHistory(newTransactions);
            } else {
                setTransactionHistory(prev => [...prev, ...newTransactions]);
            }

        } catch (error) {
            console.error("Failed to fetch transaction history:", error);
        }
        setLoading(false);
    }

    useEffect(() => {
        // Reset state when account address, search term, or sort config changes
        setTransactionHistory([]);
        setCurrentPage(1);
        if (activeAccount.accountAddress) {
            fetchTransactionHistory(activeAccount.accountAddress, 1, true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAccount.accountAddress, searchTerm, sortConfig]);

    const sortedTransactions = useMemo(() => {
        const sortableTransactions = [...transactionHistory];
        if (sortConfig !== null) {
            sortableTransactions.sort((a, b) => {
                let aKey = a[sortConfig.key];
                let bKey = b[sortConfig.key];
                if (sortConfig.key === 'TimeStamp') {
                    aKey = parseInt(aKey as string, 16);
                    bKey = parseInt(bKey as string, 16);
                }
                if (aKey < bKey) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aKey > bKey) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableTransactions;
    }, [transactionHistory, sortConfig]);

    const filteredTransactions = useMemo(() => {
        return sortedTransactions.filter(tx =>
            tx.TxType.toLowerCase().includes(searchTerm.toLowerCase()) ||
            tx.TxHash.toLowerCase().includes(searchTerm.toLowerCase()) ||
            tx.From.toLowerCase().includes(searchTerm.toLowerCase()) ||
            tx.To.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [sortedTransactions, searchTerm]);

    const requestSort = (key: keyof TransactionHistoryType) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig?.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    }

    const handleLoadMore = () => {
        if (!loading) {
            const nextPage = currentPage + 1;
            setCurrentPage(nextPage);
            if (activeAccount.accountAddress) {
                fetchTransactionHistory(activeAccount.accountAddress, nextPage);
            }
        }
    }

    return (
        <div className="p-4 sm:p-6">
            <h1 className="text-xl sm:text-2xl font-bold mb-4">Transaction History</h1>
            <div className="mb-4 flex flex-col sm:flex-row justify-between items-center">
                <input
                    type="text"
                    placeholder="Search transactions..."
                    value={searchTerm}
                    onChange={(e) => {
                        setSearchTerm(e.target.value);
                        // The useEffect will handle resetting and fetching new data
                    }}
                    className="border p-2 rounded w-full sm:w-1/3 bg-card mb-4 sm:mb-0"
                />
            </div>
            {loading && filteredTransactions.length === 0 ? (
                <div className="text-center">Loading...</div>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-card">
                            <thead>
                                <tr>
                                    <th
                                        className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base"
                                        onClick={() => requestSort('TxHash')}
                                    >
                                        Hash {sortConfig?.key === 'TxHash' ? (sortConfig.direction === 'ascending' ? '↑' : '↓') : ''}
                                    </th>
                                    <th
                                        className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base hidden sm:table-cell"
                                        onClick={() => requestSort('Amount')}
                                    >
                                        Amount (QRL) {sortConfig?.key === 'Amount' ? (sortConfig.direction === 'ascending' ? '↑' : '↓') : ''}
                                    </th>
                                    <th
                                        className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base table-cell sm:hidden"
                                        onClick={() => requestSort('Amount')}
                                    >
                                        Amount {sortConfig?.key === 'Amount' ? (sortConfig.direction === 'ascending' ? '↑' : '↓') : ''}
                                    </th>
                                    <th
                                        className="py-2 px-4 border-b cursor-pointer text-left text-sm sm:text-base"
                                        onClick={() => requestSort('TimeStamp')}
                                    >
                                        Date {sortConfig?.key === 'TimeStamp' ? (sortConfig.direction === 'ascending' ? '↑' : '↓') : ''}
                                    </th>
                                    <th className="py-2 px-4 border-b text-left text-sm sm:text-base">Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTransactions.map((tx) => (
                                    <tr key={tx.ID} className="hover:bg-muted">
                                        <td className="py-2 px-4 border-b break-all text-sm sm:text-base">
                                            {/* Truncated TxHash for Mobile */}
                                            <span className="block sm:hidden">
                                                {tx.TxHash.length > 8 ? `${tx.TxHash.slice(0, 8)}...` : tx.TxHash}
                                            </span>
                                            {/* Full TxHash for larger screens */}
                                            <span className="hidden sm:block">
                                                {tx.TxHash}
                                            </span>
                                        </td>
                                        <td className="py-2 px-4 border-b text-sm sm:text-base">{formatBalance(tx.Amount)}</td>
                                        <td className="py-2 px-4 border-b text-sm sm:text-base">
                                            {/* Short date for mobile */}
                                            <span className="block sm:hidden">
                                                {new Date(parseInt(tx.TimeStamp, 16) * 1000).toLocaleDateString()}
                                            </span>
                                            {/* Full date/time for larger screens */}
                                            <span className="hidden sm:block">
                                                {new Date(parseInt(tx.TimeStamp, 16) * 1000).toLocaleString()}
                                            </span>
                                        </td>
                                        <td className="py-2 px-4 border-b text-sm sm:text-base">
                                            <DetailsModal transaction={tx} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-4 flex justify-center">
                        <button
                            onClick={handleLoadMore}
                            className="px-4 py-2 bg-secondary hover:bg-muted rounded text-sm sm:text-base cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={loading || !hasMore}
                        >
                            {loading ? 'Loading...' : hasMore ? 'Load More' : 'No more transactions'}
                        </button>
                    </div>
                </>
            )
            }
        </div>
    );
});

type DetailsModalProps = {
    transaction: TransactionHistoryType;
};

const DetailsModal = ({ transaction }: DetailsModalProps) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="text-secondary underline text-sm sm:text-base"
            >
                View
            </button>
            {isOpen && (
                <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 p-4">
                    <div className="bg-card p-4 rounded shadow-lg w-full sm:w-1/2">
                        <h2 className="text-xl sm:text-2xl font-bold mb-2">Transaction Details</h2>
                        <div className="space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <div className="text-muted-foreground font-medium">ID:</div>
                                <div className="sm:col-span-2 break-all">{transaction.ID}</div>

                                <div className="text-muted-foreground font-medium">Type:</div>
                                <div className="sm:col-span-2">{transaction.InOut} ({transaction.TxType})</div>

                                <div className="text-muted-foreground font-medium">Address:</div>
                                <div className="sm:col-span-2 break-all">{transaction.Address}</div>

                                <div className="text-muted-foreground font-medium">From:</div>
                                <div className="sm:col-span-2 break-all">{transaction.From}</div>

                                <div className="text-muted-foreground font-medium">To:</div>
                                <div className="sm:col-span-2 break-all">{transaction.To}</div>

                                <div className="text-muted-foreground font-medium">Transaction Hash:</div>
                                <div className="sm:col-span-2 break-all">{transaction.TxHash}</div>

                                <div className="text-muted-foreground font-medium">Time:</div>
                                <div className="sm:col-span-2">{new Date(parseInt(transaction.TimeStamp, 16) * 1000).toLocaleString()}</div>

                                <div className="text-muted-foreground font-medium">Amount:</div>
                                <div className="sm:col-span-2">{transaction.Amount}</div>

                                <div className="text-muted-foreground font-medium">Fees:</div>
                                <div className="sm:col-span-2">{transaction.PaidFees}</div>

                                <div className="text-muted-foreground font-medium">Block:</div>
                                <div className="sm:col-span-2">{transaction.BlockNumber}</div>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="mt-4 px-3 py-1 bg-secondary hover:bg-muted rounded text-sm sm:text-base"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export default TransactionHistory; 