'use client'

import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Problem } from './types'

export const columns: ColumnDef<Problem>[] = [
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => {
      const { title, titleSlug } = row.original
      return (
        <Link href={`/problems/${titleSlug}`} className="hover:text-indigo-400">
          {title}
        </Link>
      )
    },
  },
  {
    accessorKey: 'difficulty',
    header: 'Difficulty',
    cell: ({ row }) => {
      const difficulty = row.getValue('difficulty') as string
      return (
        <Badge
          variant="outline"
          className={cn(
            'font-medium',
            difficulty === 'easy' && 'border-green-500/30 text-green-500',
            difficulty === 'medium' && 'border-yellow-500/30 text-yellow-500',
            difficulty === 'hard' && 'border-red-500/30 text-red-500',
          )}
        >
          {difficulty}
        </Badge>
      )
    },
  },
  {
    accessorKey: 'tags',
    header: 'Tags',
    cell: ({ row }) => {
      const tags = row.getValue('tags') as string[]
      return (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {tag}
            </Badge>
          ))}
        </div>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const { id } = row.original
      return (
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-950"
          aria-label="Practice problem"
        >
          <Link href={`/practice?problemId=${id}`}>
            <Play className="h-4 w-4" />
          </Link>
        </Button>
      )
    },
  },
]
