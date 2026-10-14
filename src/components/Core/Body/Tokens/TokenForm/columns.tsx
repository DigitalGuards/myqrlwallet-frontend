import { CopyableText, BalanceCell, HideTokenButton } from "./TokenCells";
import type { TokenInterface } from "@/constants"
import type { ColumnDef } from "@tanstack/react-table"
import { Send } from "lucide-react"
import { QrlAddress } from "@/components/UI/QrlAddress"

export const columns: ColumnDef<TokenInterface>[] = [
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
            const name = row.original.name
            return <div className="hidden md:block"><CopyableText text={name} className="font-semibold text-foreground" /></div>;
        },
    },
    {
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row }) => {
            const symbol = row.original.symbol
            return <CopyableText text={symbol} className="text-muted-foreground" />;
        },
    },
    {
        accessorKey: "address",
        header: "Token Address",
        cell: ({ row }) => {
            const address = row.original.address
            return (
                <div className="hidden md:block">
                    <QrlAddress
                        address={address}
                        compactFormat="short"
                        onShowFull={() => { row.toggleSelected(true); }}
                        copyable
                        className="font-medium"
                    />
                </div>
            );
        },
    },
    {
        accessorKey: 'amount',
        header: 'Balance',
        cell: ({ row }) => {
            const amount = row.original.amount
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
