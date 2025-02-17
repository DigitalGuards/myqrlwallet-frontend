import { TokenInterface } from "@/lib/constants"
import { ColumnDef } from "@tanstack/react-table"

export const columns: ColumnDef<TokenInterface>[] = [
    {
        accessorKey: "name",
        header: "Name",
    },
    {
        accessorKey: "symbol",
        header: "Symbol",
    },
    {
        accessorKey: "address",
        header: "Address",
        cell: ({ row }) => {
            const address: string = row.getValue('address')
            const formattedAddress = `${address?.substring(0, 5)}...${address?.substring(address?.length - 5)}`
            return <div className="font-medium">{formattedAddress}</div>
        },
    },
    {
        accessorKey: 'amount',
        header: 'Amount'
    }
]
