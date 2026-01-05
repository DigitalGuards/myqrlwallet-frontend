import { TokenInterface } from "@/constants"
import { ColumnDef } from "@tanstack/react-table"
import { Copy, Check, Send, EyeOff } from "lucide-react"
import { useState } from "react"
import { useStore } from "@/stores/store"

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

const HideTokenButton = ({ tokenAddress }: { tokenAddress: string }) => {
    const { zondStore } = useStore();

    const handleHide = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await zondStore.hideToken(tokenAddress);
    };

    return (
        <span title="Hide token">
            <EyeOff
                className="w-4 h-4 opacity-50 hover:opacity-100 cursor-pointer transition-opacity"
                onClick={handleHide}
            />
        </span>
    );
};

export const columns: ColumnDef<TokenInterface>[] = [
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
            const name: string = row.getValue('name')
            return <div className="hidden md:block"><CopyableText text={name} /></div>;
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
        header: "Token Address",
        cell: ({ row }) => {
            const address: string = row.getValue('address')
            return <div className="hidden md:block"><CopyableAddress address={address} /></div>;
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
        header: 'Actions',
        cell: ({ row }) => {
            const token = row.original;
            return (
                <div className="flex justify-evenly gap-3">
                    <span title="Send token">
                        <Send
                            className="w-4 h-4 opacity-50 hover:opacity-100 cursor-pointer transition-opacity"
                            onClick={(e) => {
                                e.stopPropagation();
                                row.toggleSelected(true);
                            }}
                        />
                    </span>
                    <HideTokenButton tokenAddress={token.address} />
                </div>
            )
        },
    }
]
