'use client'

import type React from 'react'
import { useState } from 'react'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption, ComboboxButton } from '@headlessui/react'
import { Check, ChevronsUpDown, X } from 'lucide-react'

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

interface Tag {
  id: number
  name: string
  value: string
}

interface ComboSelectProps {
  value: string[]
  onChange: (value: string[]) => void
  onBlur: () => void
  name: string
}

export function ComboSelect({ value, onChange, onBlur, name }: ComboSelectProps) {
  const [query, setQuery] = useState('')
  const [highlightedTag, setHighlightedTag] = useState<string | null>(null)

  const filteredTags = query === '' ? tags : tags.filter((tag) => tag.name.toLowerCase().includes(query.toLowerCase()))

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter((tag) => tag !== tagToRemove))
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (highlightedTag && !value.includes(highlightedTag)) {
        onChange([...value, highlightedTag])
      } else if (filteredTags.length > 0 && !value.includes(filteredTags[0]?.value || '')) {
        onChange([...value, filteredTags[0]?.value || ''])
      }
      setQuery('')
      setHighlightedTag(null)
    }
  }

  return (
    <Combobox value={value} onChange={onChange} multiple>
      <div className="relative w-full">
        <div className="relative w-full min-h-[2.5rem] cursor-default overflow-hidden rounded-md bg-zinc-800 text-left shadow-md">
          <div className="flex flex-wrap items-center gap-1 p-1">
            {value.map((tagValue) => {
              const tag = tags.find((t) => t.value === tagValue)
              return (
                <span
                  key={tagValue}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-600 text-white"
                >
                  {tag ? tag.name : tagValue}
                  <button
                    type="button"
                    onClick={() => removeTag(tagValue)}
                    className="ml-1 inline-flex items-center justify-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
            <div className="relative flex-1">
              <ComboboxInput
                className="w-full border-none py-1 pl-2 pr-8 text-sm leading-5 text-zinc-200 bg-transparent focus:ring-0 focus:outline-none"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={onBlur}
                name={name}
                placeholder={value.length === 0 ? 'Select tags...' : ''}
                value={query}
              />
            </div>
          </div>
          <ComboboxButton className="absolute inset-y-2 right-0 flex items-center pr-2">
            <ChevronsUpDown className="h-5 w-5 text-zinc-400" aria-hidden="true" />
          </ComboboxButton>
        </div>
        <ComboboxOptions className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-zinc-800 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm z-10">
          {filteredTags.length === 0 && query !== '' ? (
            <div className="relative cursor-default select-none py-2 px-4 text-zinc-400">Nothing found.</div>
          ) : (
            filteredTags.map((tag) => (
              <ComboboxOption
                key={tag.id}
                className={({ active }) =>
                  `relative cursor-default select-none py-2 pl-10 pr-4 ${
                    active ? 'bg-indigo-600 text-white' : 'text-zinc-200'
                  }`
                }
                value={tag.value}
                onFocus={() => setHighlightedTag(tag.value)}
              >
                {({ selected, active }) => (
                  <>
                    <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>{tag.name}</span>
                    {selected ? (
                      <span
                        className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                          active ? 'text-white' : 'text-indigo-600'
                        }`}
                      >
                        <Check className="h-5 w-5" aria-hidden="true" />
                      </span>
                    ) : null}
                  </>
                )}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
      </div>
    </Combobox>
  )
}
