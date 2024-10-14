'use client'

import React, { useMemo } from 'react'
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnDef, Table as ReactTable } from '@tanstack/react-table'
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
}

interface MemoizedTableContentProps<TData, TValue> {
  table: ReactTable<TData>
  columns: ColumnDef<TData, TValue>[]
}

function MemoizedTableContent<TData, TValue>({ table, columns }: MemoizedTableContentProps<TData, TValue>) {
  return (
    <UITable>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center">
              No results.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </UITable>
  )
}

const MemoizedTableContentWrapper = React.memo(MemoizedTableContent) as typeof MemoizedTableContent

export function DataTable<TData, TValue>({ columns, data }: DataTableProps<TData, TValue>) {
  const memoizedColumns = useMemo(() => columns, [columns])
  const memoizedData = useMemo(() => data, [data])

  const table = useReactTable({
    data: memoizedData,
    columns: memoizedColumns,
    getCoreRowModel: getCoreRowModel(),
  })

  const memoizedTableContent = useMemo(
    () => <MemoizedTableContentWrapper table={table} columns={memoizedColumns} />,
    [table, memoizedColumns],
  )

  return <div className="rounded-md border">{memoizedTableContent}</div>
}
