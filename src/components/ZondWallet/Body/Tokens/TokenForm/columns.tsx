import { TokenInterface } from "@/lib/constants"
import { ColumnDef } from "@tanstack/react-table"
import { Copy, Check, Send } from "lucide-react"
import { useState } from "react"

// Create a component for the cell to manage its own copy state
const CopyableAddress = ({ address }: { address: string }) => {
    const [isCopied, setIsCopied] = useState(false);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setIsCopied(true);
        setTimeout(() => {
            setIsCopied(false);
        }, 1500);
    };

    const formattedAddress = `${address?.substring(0, 5)}...${address?.substring(address?.length - 5)}`;

    return (
        <div className="font-medium flex items-center gap-2 group">
            <span>{formattedAddress}</span>
            {isCopied ? (
                <Check className="w-4 h-4 text-green-500" />
            ) : (
                <Copy
                    className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-gray-400 transition-opacity cursor-pointer"
                    onClick={() => copyToClipboard(address)}
                />
            )}
        </div>
    );
};

const CopyableText = ({ text }: { text: string }) => {
    const [isCopied, setIsCopied] = useState(false);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setIsCopied(true);
        setTimeout(() => {
            setIsCopied(false);
        }, 1500);
    };

    return (
        <div className="flex items-center gap-2 group">
            <span>{text}</span>
            {isCopied ? (
                <Check className="w-4 h-4 text-green-500" />
            ) : (
                <Copy
                    className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-gray-400 transition-opacity cursor-pointer"
                    onClick={() => copyToClipboard(text)}
                />
            )}
        </div>
    );
};

export const columns: ColumnDef<TokenInterface>[] = [
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
            const name: string = row.getValue('name')
            return <CopyableText text={name} />;
        },
    },
    {
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row }) => {
            const symbol: string = row.getValue('symbol')
            return <CopyableText text={symbol} />;
        },
    },
    {
        accessorKey: "address",
        header: "Contract Address",
        cell: ({ row }) => {
            const address: string = row.getValue('address')
            return <CopyableAddress address={address} />;
        },
    },
    {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ row }) => {
            const amount: string = row.getValue('amount')
            return <CopyableText text={amount} />;
        }
    },
    {
        id: 'actions',
        header: 'Send',
        cell: ({ row }) => {
            return (
                <div className="flex justify-evenly">
                    <Send
                        className="w-4 h-4 opacity-50 hover:opacity-100 cursor-pointer transition-opacity"
                        onClick={(e) => {
                            e.stopPropagation();
                            row.toggleSelected(true);
                        }}
                    />
                </div>
            )
        },
    }
]
