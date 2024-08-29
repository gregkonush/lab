'use client'

import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { useState } from 'react'

interface Tag {
  id: number
  name: string
}

const tags = [
  { id: 1, name: 'Array' },
  { id: 2, name: 'Dynamic Programming' },
  { id: 3, name: 'Graph' },
  { id: 4, name: 'Greedy' },
  { id: 5, name: 'Hash Table' },
  { id: 6, name: 'Heap' },
  { id: 7, name: 'Math' },
  { id: 8, name: 'Number Theory' },
  { id: 9, name: 'Parsing' },
  { id: 10, name: 'Simulation' },
  { id: 11, name: 'Sorting' },
  { id: 12, name: 'String' },
  { id: 13, name: 'Tree' },
  { id: 14, name: 'Two Pointers' },
  { id: 15, name: 'Binary Search' },
  { id: 16, name: 'Divide and Conquer' },
  { id: 17, name: 'Depth First Search' },
  { id: 18, name: 'Breadth First Search' },
  { id: 19, name: 'Union Find' },
  { id: 20, name: 'Topological Sort' },
  { id: 21, name: 'Binary Tree' },
  { id: 22, name: 'Binary Search Tree' },
  { id: 23, name: 'Segment Tree' },
  { id: 24, name: 'Binary Indexed Tree' },
  { id: 25, name: 'Tree Decomposition' },
  { id: 26, name: 'Trie' },
  { id: 27, name: 'Djikstra' },
  { id: 28, name: 'Bellman Ford' },
  { id: 29, name: 'Floyd Warshall' },
  { id: 30, name: 'Recursion' },
  { id: 31, name: 'Sliding Window' },
  { id: 32, name: 'Linked List' },
  { id: 33, name: 'Stack' },
  { id: 34, name: 'Queue' },
  { id: 35, name: 'Doubly Linked List' },
  { id: 36, name: 'Priority Queue' },
]

export function ComboSelect() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Tag[]>([])

  const filteredtags =
    query === ''
      ? tags
      : tags.filter((tag) => {
          return tag.name.toLowerCase().includes(query.toLowerCase())
        })

  return (
    <Combobox value={selected} onChange={(value: Tag[]) => setSelected(value)} onClose={() => setQuery('')}>
      <div className="relative">
        <ComboboxInput
          className={clsx(
            'w-full rounded-lg bg-zinc-950 border py-1.5 pr-8 pl-3 text-sm/6 text-white',
            'focus:outline-none data-[focus]:outline-2 data-[focus]:-outline-offset-2 data-[focus]:outline-white/25'
          )}
          displayValue={(tag: { name: string }) => tag.name}
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
        {filteredtags.map((tag) => (
          <ComboboxOption
            key={tag.id}
            value={tag}
            className="group flex cursor-default items-center gap-2 rounded-lg py-1.5 px-3 select-none data-[focus]:bg-white/10"
          >
            <CheckIcon className="invisible size-4 fill-white group-data-[selected]:visible" />
            <div className="text-sm/6 text-white">{tag.name}</div>
          </ComboboxOption>
        ))}
      </ComboboxOptions>
    </Combobox>
  )
}
