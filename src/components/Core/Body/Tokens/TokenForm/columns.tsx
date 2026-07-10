import type { TokenInterface } from "@/constants"
import type { ColumnDef } from "@tanstack/react-table"
import { Copy, Check, Send, EyeOff } from "lucide-react"
import { useState } from "react"
import { observer } from "mobx-react-lite"
import { useStore } from "@/stores/store"
import { copyToClipboard } from "@/utils/nativeApp"
import { SlotBalance } from "../../Home/AccountCreateImport/ActiveAccountDisplay/SlotBalance"

// Create a component for the cell to manage its own copy state
const CopyableAddress = ({ address }: { address: string }) => {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = async (text: string) => {
        const success = await copyToClipboard(text);
        if (success) {
            setIsCopied(true);
            setTimeout(() => {
                setIsCopied(false);
            }, 1500);
        }
    };

    const formattedAddress = `${address?.substring(0, 5)}...${address?.substring(address?.length - 5)}`;

    return (
        <div className="font-medium flex items-center gap-2 group">
            <span>{formattedAddress}</span>
            {isCopied ? (
                <Check className="w-4 h-4 text-success" />
            ) : (
                <Copy
                    className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity cursor-pointer"
                    onClick={() => handleCopy(address)}
                />
            )}
        </div>
    );
};

const CopyableText = ({ text, className }: { text: string; className?: string }) => {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = async (textToCopy: string) => {
        const success = await copyToClipboard(textToCopy);
        if (success) {
            setIsCopied(true);
            setTimeout(() => {
                setIsCopied(false);
            }, 1500);
        }
    };

    return (
        <div className="flex items-center gap-2 group">
            <span className={className}>{text}</span>
            {isCopied ? (
                <Check className="w-4 h-4 text-success" />
            ) : (
                <Copy
                    className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity cursor-pointer"
                    onClick={() => handleCopy(text)}
                />
            )}
        </div>
    );
};

// Token amount cell with the QRL-balance-style slot-machine cascade
// while tokenStore.isRefreshingBalances is on, plus the same copy
// affordance as CopyableText.
const BalanceCell = observer(({ amount }: { amount: string }) => {
    const { tokenStore } = useStore();
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = async (textToCopy: string) => {
        const success = await copyToClipboard(textToCopy);
        if (success) {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 1500);
        }
    };

    return (
        <div className="flex items-center gap-2 group">
            <SlotBalance value={amount} spinning={tokenStore.isRefreshingBalances} />
            {isCopied ? (
                <Check className="w-4 h-4 text-success" />
            ) : (
                <Copy
                    className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity cursor-pointer"
                    onClick={() => handleCopy(amount)}
                />
            )}
        </div>
    );
});

const HideTokenButton = ({ tokenAddress }: { tokenAddress: string }) => {
    const { tokenStore } = useStore();

    const handleHide = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await tokenStore.hideToken(tokenAddress);
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
            return <div className="hidden md:block"><CopyableText text={name} className="font-semibold text-foreground" /></div>;
        },
    },
    {
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row }) => {
            const symbol: string = row.getValue('symbol')
            return <CopyableText text={symbol} className="text-muted-foreground" />;
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
        header: 'Balance',
        cell: ({ row }) => {
            const amount: string = row.getValue('amount')
            return <BalanceCell amount={amount} />;
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
