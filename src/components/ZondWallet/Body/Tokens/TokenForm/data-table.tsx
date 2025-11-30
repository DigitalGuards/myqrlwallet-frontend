import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from "@tanstack/react-table"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/UI/table"
import { SendTokenModal } from "../SendTokenModal.tsx/SendTokenModal"
import { useState, useEffect } from "react";
import { TokenInterface } from "@/lib/constants";
import { Loader2 } from "lucide-react";

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[]
    data: TData[]
    isLoading?: boolean
}

export function DataTable<TData, TValue>({
    columns,
    data,
    isLoading = false,
}: DataTableProps<TData, TValue>) {
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
    })
    const [isSendTokenModalOpen, setIsSendTokenModalOpen] = useState(false);
    const [selectedToken, setSelectedToken] = useState<TData | null>(null);

    // Watch for row selection changes
    useEffect(() => {
        const selectedRows = table.getSelectedRowModel().rows;
        if (selectedRows.length > 0) {
            setSelectedToken(selectedRows[0].original);
            setIsSendTokenModalOpen(true);
            // Reset selection after modal opens
            table.resetRowSelection();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table.getState().rowSelection]);

    if (isLoading) {
        return (
            <div className="rounded-md border overflow-x-auto w-full p-8">
                <div className="flex justify-center items-center h-24">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-md border overflow-x-auto w-full">
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => {
                                return (
                                    <TableHead
                                        key={header.id}
                                        className={`${header.column.id === 'name' || header.column.id === 'address'
                                                ? 'hidden md:table-cell'
                                                : ''
                                            }`}
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                    </TableHead>
                                )
                            })}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow
                                key={row.id}
                                data-state={row.getIsSelected() && "selected"}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell
                                        key={cell.id}
                                        className={`${cell.column.id === 'name' || cell.column.id === 'address'
                                                ? 'hidden md:table-cell'
                                                : ''
                                            }`}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell colSpan={columns.length} className="h-24 text-center">
                                No tokens currently added or created.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
            <SendTokenModal
                isOpen={isSendTokenModalOpen}
                onClose={() => setIsSendTokenModalOpen(false)}
                token={selectedToken as TokenInterface}
            />
        </div>
    )
}
