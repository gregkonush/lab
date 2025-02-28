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
  if (isLoading) return <div className="py-2 text-sm text-zinc-300">Loading pods...</div>
  if (error)
    return (
      <div className="py-2 text-sm text-red-400">
        Error loading pods: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  if (!pods?.length) return <div className="py-2 text-sm text-zinc-300">No pods found</div>

  return (
    <div className="rounded-md border border-zinc-700 overflow-hidden text-sm">
      <table className="w-full text-left">
        <thead className="bg-zinc-900 text-zinc-100 border-b border-zinc-700">
          <tr>
            <th className="py-2 px-3 font-medium">Name</th>
            <th className="py-2 px-3 font-medium">Namespace</th>
            <th className="py-2 px-3 font-medium">Status</th>
            <th className="py-2 px-3 font-medium">Created</th>
            <th className="py-2 px-3 font-medium">IP</th>
          </tr>
        </thead>
        <tbody className="bg-zinc-950 text-zinc-300">
          {pods.map((pod) => (
            <tr
              key={`${pod.metadata?.namespace}-${pod.metadata?.name}`}
              className="border-b border-zinc-800 hover:bg-zinc-900 transition-colors"
            >
              <td className="py-1.5 px-3 font-medium">{pod.metadata?.name || 'N/A'}</td>
              <td className="py-1.5 px-3">{pod.metadata?.namespace || 'N/A'}</td>
              <td className="py-1.5 px-3">
                <span className={getStatusBadgeClass(pod.status?.phase)}>{pod.status?.phase || 'Unknown'}</span>
              </td>
              <td className="py-1.5 px-3">{formatCreationTime(pod.metadata?.creationTimestamp)}</td>
              <td className="py-1.5 px-3">{pod.status?.podIP || 'N/A'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

PodTable.displayName = 'PodTable'

export const Route = createFileRoute('/')({
  component: IndexComponent,
})

export function IndexComponent() {
  const { data: pods, isLoading, error } = useQuery(trpc.pods.queryOptions())

  return (
    <div className="container mx-auto py-6 px-4">
      <h1 className="text-2xl font-bold mb-6 text-zinc-100">Kubernetes Pods</h1>
      <PodTable pods={pods} isLoading={isLoading} error={error} />
    </div>
  )
}
