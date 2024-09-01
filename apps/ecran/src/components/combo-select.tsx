'use client'

import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { useState } from 'react'

interface Tag {
  id: number
  name: string
  value: string
}

const tags = [
  { id: 1, name: 'Array', value: 'array' },
  { id: 2, name: 'Dynamic Programming', value: 'dynamic-programming' },
  { id: 3, name: 'Graph', value: 'graph' },
  { id: 4, name: 'Greedy', value: 'greedy' },
  { id: 5, name: 'Hash Table', value: 'hash-table' },
  { id: 6, name: 'Heap', value: 'heap' },
  { id: 7, name: 'Math', value: 'math' },
  { id: 8, name: 'Number Theory', value: 'number-theory' },
  { id: 9, name: 'Parsing', value: 'parsing' },
  { id: 10, name: 'Simulation', value: 'simulation' },
  { id: 11, name: 'Sorting', value: 'sorting' },
  { id: 12, name: 'String', value: 'string' },
  { id: 13, name: 'Tree', value: 'tree' },
  { id: 14, name: 'Two Pointers', value: 'two-pointers' },
  { id: 15, name: 'Binary Search', value: 'binary-search' },
  { id: 16, name: 'Divide and Conquer', value: 'divide-and-conquer' },
  { id: 17, name: 'Depth First Search', value: 'depth-first-search' },
  { id: 18, name: 'Breadth First Search', value: 'breadth-first-search' },
  { id: 19, name: 'Union Find', value: 'union-find' },
  { id: 20, name: 'Topological Sort', value: 'topological-sort' },
  { id: 21, name: 'Binary Tree', value: 'binary-tree' },
  { id: 22, name: 'Binary Search Tree', value: 'binary-search-tree' },
  { id: 23, name: 'Segment Tree', value: 'segment-tree' },
  { id: 24, name: 'Binary Indexed Tree', value: 'binary-indexed-tree' },
  { id: 25, name: 'Tree Decomposition', value: 'tree-decomposition' },
  { id: 26, name: 'Trie', value: 'trie' },
  { id: 27, name: 'Djikstra', value: 'djikstra' },
  { id: 28, name: 'Bellman Ford', value: 'bellman-ford' },
  { id: 29, name: 'Floyd Warshall', value: 'floyd-warshall' },
  { id: 30, name: 'Recursion', value: 'recursion' },
  { id: 31, name: 'Sliding Window', value: 'sliding-window' },
  { id: 32, name: 'Linked List', value: 'linked-list' },
  { id: 33, name: 'Stack', value: 'stack' },
  { id: 34, name: 'Queue', value: 'queue' },
  { id: 35, name: 'Doubly Linked List', value: 'doubly-linked-list' },
  { id: 36, name: 'Priority Queue', value: 'priority-queue' },
]

export function ComboSelect() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>()

  const filteredtags =
    query === ''
      ? tags
      : tags.filter((tag) => {
          return tag.name.toLowerCase().includes(query.toLowerCase())
        })

  return (
    <Combobox
      value={selected ?? ''}
      name="tags"
      onChange={(value: string) => setSelected(value)}
      onClose={() => setQuery('')}
    >
      <div className="relative">
        <ComboboxInput
          className={clsx(
            'w-full rounded-lg bg-zinc-950 border py-1.5 pr-8 pl-3 text-sm/6 text-gray-200',
            'data-[focus]:outline-none data-[focus]:ring-2 data-[focus]:ring-white/80 ring-offset-background ring-offset-2'
          )}
          displayValue={(tag: string) => tags.find((t) => t.value === tag)?.name || 'Select a Topic'}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxButton className="group absolute inset-y-0 right-0 px-2.5">
          <ChevronDownIcon className="size-4 fill-white/60 group-data-[hover]:fill-white" />
        </ComboboxButton>
      </div>

      <ComboboxOptions
        anchor="bottom"
        transition
        className={clsx(
          'h-64 w-[var(--input-width)] rounded-xl border border-white/5',
          'bg-zinc-950 p-1 [--anchor-gap:var(--spacing-1)] empty:invisible',
          'transition duration-100 ease-in data-[leave]:data-[closed]:opacity-0'
        )}
      >
        {filteredtags.map(({ id, name, value }) => (
          <ComboboxOption
            key={id}
            value={value}
            className="group flex cursor-default items-center gap-2 rounded-lg py-1.5 px-2 select-none data-[focus]:bg-white/10"
          >
            <CheckIcon className="invisible size-4 fill-white group-data-[selected]:visible" />
            <div className="text-sm/6 text-white">{name}</div>
          </ComboboxOption>
        ))}
      </ComboboxOptions>
    </Combobox>
  )
}
