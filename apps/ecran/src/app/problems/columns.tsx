'use client'

import { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'

type Problem = {
  id: string
  title: string
  difficulty: string
  tags: string[]
}
export const columns: ColumnDef<Problem>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({
      row: {
        original: { id, title },
      },
    }) => (
      <Link href={`/problems/${id}`} className="hover:text-sky-500">
        {title}
      </Link>
    ),
  },
  {
    accessorKey: 'difficulty',
    header: 'Difficulty',
  },
  {
    accessorKey: 'tags',
    header: 'Tags',
  },
]
