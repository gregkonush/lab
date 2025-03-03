import type * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { trpc } from '../router'
import type { Container, ContainerPort } from '~/common/schemas/pod'

export const Route = createFileRoute('/pods/$namespace/$podName')({
  component: PodDetailsComponent,
})

// Extract the common header component
function PodDetailsHeader({ title }: { title: string }) {
  return (
    <div className="flex justify-between items-center mb-6">
      <Link to="/" className="flex items-center text-zinc-300 hover:text-zinc-100 transition-colors">
        <svg
          className="h-5 w-5 mr-2"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <title>Back Arrow</title>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Pods
      </Link>
      <h1 className="text-2xl font-bold text-zinc-100">{title}</h1>
    </div>
  )
}

// Extract the container layout
function PodDetailsContainer({ children }: { children: React.ReactNode }) {
  return <div className="container mx-auto py-6 px-4">{children}</div>
}

// Extract the content container
function PodDetailsContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-zinc-700 text-sm overflow-hidden rounded-md h-[calc(100vh-10rem)]">{children}</div>
  )
}

export function PodDetailsComponent() {
  const { podName, namespace } = Route.useParams()
  const {
    data: pod,
    isLoading,
    error,
  } = useQuery(
    trpc.pod.byName.queryOptions({
      podName,
      namespace,
    }),
  )

  if (isLoading) {
    return (
      <PodDetailsContainer>
        <PodDetailsHeader title="Pod Details" />
        <PodDetailsContent>
          <div className="w-full py-2 text-sm text-zinc-300 flex items-center justify-center h-full">
            Loading pod details...
          </div>
        </PodDetailsContent>
      </PodDetailsContainer>
    )
  }

  if (error || !pod) {
    return (
      <PodDetailsContainer>
        <PodDetailsHeader title="Pod Details" />
        <PodDetailsContent>
          <div className="w-full py-2 text-red-400 flex items-center justify-center h-full">
            {error instanceof Error ? error.message : 'Failed to load pod details'}
          </div>
        </PodDetailsContent>
      </PodDetailsContainer>
    )
  }

  return (
    <PodDetailsContainer>
      <PodDetailsHeader title={`Pod: ${pod.metadata?.name || 'Unknown'}`} />
      <PodDetailsContent>
        <div className="p-6 overflow-y-auto h-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-zinc-900 p-4 rounded-md border border-zinc-700">
              <h2 className="text-lg font-medium text-zinc-100 mb-3">Metadata</h2>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Namespace:</span>
                  <span className="text-zinc-200">{pod.metadata?.namespace || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Created:</span>
                  <span className="text-zinc-200">
                    {pod.metadata?.creationTimestamp
                      ? new Date(pod.metadata.creationTimestamp).toLocaleString()
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">UID:</span>
                  <span className="text-zinc-200">{pod.metadata?.uid || 'N/A'}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 p-4 rounded-md border border-zinc-700">
              <h2 className="text-lg font-medium text-zinc-100 mb-3">Status</h2>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Phase:</span>
                  <span className="text-zinc-200">{pod.status?.phase || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Pod IP:</span>
                  <span className="text-zinc-200">{pod.status?.podIP || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Host IP:</span>
                  <span className="text-zinc-200">{pod.status?.hostIP || 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900 p-4 rounded-md border border-zinc-700 mb-6">
            <h2 className="text-lg font-medium text-zinc-100 mb-3">Spec</h2>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-400">Node Name:</span>
                <span className="text-zinc-200">{pod.spec?.nodeName || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Restart Policy:</span>
                <span className="text-zinc-200">{pod.spec?.restartPolicy || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Service Account:</span>
                <span className="text-zinc-200">{pod.spec?.serviceAccountName || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">DNS Policy:</span>
                <span className="text-zinc-200">{pod.spec?.dnsPolicy || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Priority:</span>
                <span className="text-zinc-200">{pod.spec?.priority !== undefined ? pod.spec.priority : 'N/A'}</span>
              </div>
            </div>
          </div>

          {pod.spec?.containers && (
            <div className="bg-zinc-900 p-4 rounded-md border border-zinc-700">
              <h2 className="text-lg font-medium text-zinc-100 mb-3">Containers</h2>
              <div className="space-y-4">
                {pod.spec.containers.map((container: Container) => (
                  <div key={container.name} className="bg-zinc-950 p-4 rounded-md border border-zinc-800">
                    <h3 className="text-md font-medium text-zinc-100 mb-2">{container.name}</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Image:</span>
                        <span className="text-zinc-200">{container.image || 'N/A'}</span>
                      </div>
                      {container.ports && container.ports.length > 0 && (
                        <div>
                          <span className="text-zinc-400">Ports:</span>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {container.ports.map((port: ContainerPort) => (
                              <span
                                key={`${port.containerPort}-${port.protocol || 'TCP'}`}
                                className="px-2 py-1 bg-zinc-800 rounded text-xs"
                              >
                                {port.containerPort}
                                {port.protocol ? `/${port.protocol}` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PodDetailsContent>
    </PodDetailsContainer>
  )
}
