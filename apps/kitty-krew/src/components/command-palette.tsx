import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { trpc } from '~/app/router.tsx'
import { cn } from '~/utils/cn'
import { StatusBadge } from './status-badge'
import { useQuery } from '@tanstack/react-query'
import type { Pod } from '~/common/schemas/pod'

export function CommandPalette() {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const commandPaletteRef = useRef<HTMLDivElement>(null)

  const { data: pods, isLoading } = useQuery({
    ...trpc.pod.list.queryOptions(),
    enabled: isOpen,
    staleTime: 10000, // 10 seconds
  })

  const filteredPods = useMemo(() => {
    // Reset selected index when the search results change
    setSelectedIndex(0)

    return pods
      ? pods.filter(
          (pod) =>
            pod.metadata?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            pod.metadata?.namespace?.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : []
  }, [pods, searchQuery])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD+K or Ctrl+K to open
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(true)
      }

      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    // Handle click outside to close
    const handleClickOutside = (e: MouseEvent) => {
      if (commandPaletteRef.current && !commandPaletteRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev < filteredPods.length - 1 ? prev + 1 : prev))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === 'Enter' && filteredPods.length > 0) {
      e.preventDefault()
      if (selectedIndex >= 0 && selectedIndex < filteredPods.length) {
        const selectedPod = filteredPods[selectedIndex]
        navigateToPod(selectedPod)
      }
    }
  }

  const navigateToPod = (pod: Pod) => {
    if (pod.metadata?.name && pod.metadata?.namespace) {
      navigate({
        to: '/pods/$namespace/$podName',
        params: {
          namespace: pod.metadata.namespace,
          podName: pod.metadata.name,
        },
      })
      setIsOpen(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[20vh]">
      <div
        ref={commandPaletteRef}
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden"
      >
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search for pods..."
            className="w-full p-4 bg-zinc-900 text-zinc-200 placeholder-zinc-500 border-b border-zinc-700 focus:outline-none focus:ring-0"
            autoComplete="off"
          />
          <kbd className="absolute right-4 top-4 inline-flex gap-1 px-2 py-1 text-xs text-zinc-400 bg-zinc-800 rounded border border-zinc-700">
            <span className="text-xs">esc</span>
            <span className="text-xs">to close</span>
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {isLoading && (
            <div className="p-4 text-center text-zinc-500">
              <span className="animate-pulse">Loading pods...</span>
            </div>
          )}

          {!isLoading && filteredPods.length === 0 && (
            <div className="p-4 text-center text-zinc-500">
              {searchQuery ? 'No pods match your search' : 'Type to search for pods'}
            </div>
          )}

          {!isLoading && filteredPods.length > 0 && (
            <ul className="divide-y divide-zinc-800">
              {filteredPods.map((pod, index) => (
                <button
                  type="button"
                  key={`${pod.metadata?.namespace}/${pod.metadata?.name}`}
                  className={cn(
                    'w-full text-left px-4 py-3 cursor-pointer flex justify-between items-center hover:bg-zinc-800 transition-colors',
                    index === selectedIndex && 'bg-zinc-800',
                  )}
                  onClick={() => navigateToPod(pod)}
                >
                  <div className="flex flex-col">
                    <span className="text-zinc-200 font-medium">{pod.metadata?.name}</span>
                    <span className="text-zinc-400 text-sm">Namespace: {pod.metadata?.namespace}</span>
                  </div>
                  <StatusBadge status={pod.status?.phase || ''} />
                </button>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
