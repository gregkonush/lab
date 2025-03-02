import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { trpc } from '../router'

// Define pod interface based on Kubernetes types
interface PodMetadata {
  name?: string
  namespace?: string
  creationTimestamp?: string
  uid?: string
}

interface PodStatus {
  phase?: string
  podIP?: string
}

interface Pod {
  metadata?: PodMetadata
  status?: PodStatus
}

interface PodTableProps {
  pods?: Pod[]
  isLoading: boolean
  error: unknown
}

// Memoized PodTable component
const PodTable = React.memo(({ pods, isLoading, error }: PodTableProps) => {
  // Safely format the creation time
  const formatCreationTime = React.useCallback((dateString?: string): string => {
    if (!dateString) return 'N/A'
    // Format to match the screenshot (MM/DD/YYYY, hh:mm:ss AM/PM)
    const date = new Date(dateString)
    return `${date.toLocaleDateString()}, ${date.toLocaleTimeString()}`
  }, [])

  // Get status badge styling
  const getStatusBadgeClass = React.useCallback((status?: string): string => {
    const baseClasses = 'px-2 py-0.5 rounded-full text-xs font-medium'

    switch (status) {
      case 'Running':
        return `${baseClasses} bg-green-700 text-green-100`
      case 'Pending':
        return `${baseClasses} bg-yellow-700 text-yellow-100`
      case 'Failed':
        return `${baseClasses} bg-red-700 text-red-100`
      case 'Succeeded':
        return `${baseClasses} bg-blue-700 text-blue-100`
      default:
        return `${baseClasses} bg-zinc-700 text-zinc-100`
    }
  }, [])

  // Render pods with loading and error states
  if (isLoading)
    return (
      <div className="border border-zinc-700 text-sm overflow-hidden rounded-md h-[calc(100vh-10rem)]">
        <div className="w-full py-2 text-sm text-zinc-300 flex items-center justify-center h-full">Loading pods...</div>
      </div>
    )

  if (error)
    return (
      <div className="border border-zinc-700 text-sm overflow-hidden rounded-md h-[calc(100vh-10rem)]">
        <div className="w-full py-2 text-sm text-red-400 flex items-center justify-center h-full">
          Error loading pods: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      </div>
    )

  if (!pods?.length)
    return (
      <div className="border border-zinc-700 text-sm overflow-hidden rounded-md h-[calc(100vh-10rem)]">
        <div className="w-full py-2 text-sm text-zinc-300 flex items-center justify-center h-full">No pods found</div>
      </div>
    )

  return (
    <div className="border border-zinc-700 text-sm overflow-hidden rounded-md h-[calc(100vh-10rem)]">
      <div className="w-full">
        <table className="w-full text-left table-fixed">
          <thead className="bg-zinc-900 text-zinc-100 border-b border-zinc-700">
            <tr>
              <th className="py-2 px-3 font-medium w-[30%]">Name</th>
              <th className="py-2 px-3 font-medium w-[20%]">Namespace</th>
              <th className="py-2 px-3 font-medium w-[15%]">Status</th>
              <th className="py-2 px-3 font-medium w-[20%]">Created</th>
              <th className="py-2 px-3 font-medium w-[15%]">IP</th>
            </tr>
          </thead>
        </table>
      </div>
      <div className="overflow-y-auto h-[calc(100vh-12rem-6px)]">
        <table className="w-full text-left table-fixed">
          <tbody className="bg-zinc-950 text-zinc-300">
            {pods.map((pod) => (
              <tr
                key={`${pod.metadata?.namespace}-${pod.metadata?.name}`}
                className="border-b border-zinc-800 hover:bg-zinc-900 transition-colors"
              >
                <td className="py-1.5 px-3 font-medium w-[30%] truncate">{pod.metadata?.name || 'N/A'}</td>
                <td className="py-1.5 px-3 w-[20%] truncate">{pod.metadata?.namespace || 'N/A'}</td>
                <td className="py-1.5 px-3 w-[15%]">
                  <span className={getStatusBadgeClass(pod.status?.phase)}>{pod.status?.phase || 'Unknown'}</span>
                </td>
                <td className="py-1.5 px-3 w-[20%] truncate">{formatCreationTime(pod.metadata?.creationTimestamp)}</td>
                <td className="py-1.5 px-3 w-[15%] truncate">{pod.status?.podIP || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})

PodTable.displayName = 'PodTable'

export const Route = createFileRoute('/')({
  component: IndexComponent,
})

export function IndexComponent() {
  const { data: pods, isLoading, error } = useQuery(trpc.pods.queryOptions())
  const [searchQuery, setSearchQuery] = React.useState('')
  const [namespaceFilter, setNamespaceFilter] = React.useState<string>('all')

  const handleSearchChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  const handleNamespaceChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setNamespaceFilter(e.target.value)
  }, [])

  // Extract unique namespaces for filter dropdown
  const namespaces = React.useMemo(() => {
    if (!pods) return []
    const namespaceSet = new Set<string>()

    for (const pod of pods) {
      if (pod.metadata?.namespace) {
        namespaceSet.add(pod.metadata.namespace)
      }
    }

    return Array.from(namespaceSet).sort()
  }, [pods])

  // Filter pods based on search query and namespace filter
  const filteredPods = React.useMemo(() => {
    if (!pods) return []

    return pods.filter((pod) => {
      // Apply namespace filter
      if (namespaceFilter !== 'all' && pod.metadata?.namespace !== namespaceFilter) {
        return false
      }

      // Apply search filter if there's a query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return (
          pod.metadata?.name?.toLowerCase().includes(query) ||
          pod.metadata?.namespace?.toLowerCase().includes(query) ||
          pod.status?.phase?.toLowerCase().includes(query)
        )
      }

      return true
    })
  }, [pods, searchQuery, namespaceFilter])

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="flex justify-between items-center mb-6">
        <div className="flex gap-4 items-center">
          <div className="relative w-64">
            <input
              type="text"
              placeholder="Search pods..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full px-3 py-2 bg-zinc-800 text-zinc-200 rounded-md border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-600 placeholder:text-zinc-500"
              aria-label="Search pods"
            />
            <svg
              className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <title>Search</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <div className="w-48 relative">
            <select
              value={namespaceFilter}
              onChange={handleNamespaceChange}
              className="w-full px-3 py-2 bg-zinc-800 text-zinc-200 rounded-md border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-600 appearance-none pr-8"
              aria-label="Filter by namespace"
            >
              <option value="all">All namespaces</option>
              {namespaces.map((namespace) => (
                <option key={namespace} value={namespace}>
                  {namespace}
                </option>
              ))}
            </select>
            <svg
              className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-zinc-100">Kubernetes Pods</h1>
      </div>
      <div className="w-full">
        <PodTable pods={filteredPods} isLoading={isLoading} error={error} />
      </div>
    </div>
  )
}
