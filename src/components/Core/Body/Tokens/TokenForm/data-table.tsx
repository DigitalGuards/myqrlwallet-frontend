import type {
    ColumnDef} from "@tanstack/react-table";
import {
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
import { useEffect, type ReactNode } from "react";
import type { TokenInterface } from "@/constants";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/router/router";

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[]
    data: TData[]
    isLoading?: boolean
    emptyMessage?: ReactNode
}

export function DataTable<TData, TValue>({
    columns,
    data,
    isLoading = false,
    emptyMessage,
}: DataTableProps<TData, TValue>) {
    const navigate = useNavigate();
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
    })

    // Watch for row selection changes - navigate to Transfer page
    useEffect(() => {
        const selectedRows = table.getSelectedRowModel().rows;
        const firstRow = selectedRows[0];
        if (firstRow) {
            const token = firstRow.original as TokenInterface;
            // Reset selection before navigating
            table.resetRowSelection();
            // Navigate to Transfer page with token address as query param
            navigate(`${ROUTES.TRANSFER}?asset=${token.address}`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table.getState().rowSelection, navigate]);

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
                                {emptyMessage ?? "No tokens currently added or created."}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
