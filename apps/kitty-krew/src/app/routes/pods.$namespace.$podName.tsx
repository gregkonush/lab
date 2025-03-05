import React, { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { trpc } from '~/app/router.tsx'
import type { Container, ContainerPort } from '~/common/schemas/pod.ts'

export const Route = createFileRoute('/pods/$namespace/$podName')({
  component: PodDetailsComponent,
})

// Extract the common header component
function PodDetailsHeader({ title }: { title: string }) {
  return (
    <div className="flex justify-between items-center mb-6">
      <Link to="/" className="flex items-center text-zinc-400/80 hover:text-zinc-400 transition-colors cursor-default">
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
      <h1 className="text-2xl font-bold text-zinc-300">{title}</h1>
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

function LogViewer({ logs }: { logs: string | null | undefined }) {
  const logContainerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [])

  if (!logs) {
    return (
      <div className="bg-zinc-900 p-4 rounded-md border border-zinc-700 h-64 mt-6 flex items-center justify-center">
        <span className="text-zinc-400/80">No logs available</span>
      </div>
    )
  }

  return (
    <div ref={logContainerRef} className="bg-zinc-900 p-4 rounded-md border border-zinc-700 overflow-auto h-64">
      <pre className="text-zinc-300 text-xs whitespace-pre-wrap">{logs}</pre>
    </div>
  )
}

export function PodDetailsComponent() {
  const { podName, namespace } = Route.useParams()
  const [selectedContainer, setSelectedContainer] = useState<string>('')

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

  // Set first container as default when pod data loads
  React.useEffect(() => {
    if (pod?.spec?.containers && pod.spec.containers.length > 0 && !selectedContainer) {
      setSelectedContainer(pod.spec.containers[0].name)
    }
  }, [pod, selectedContainer])

  const {
    data: logs,
    isLoading: isLoadingLogs,
    error: logsError,
  } = useQuery({
    ...trpc.pod.logs.queryOptions({
      podName,
      namespace,
      container: selectedContainer,
    }),
    enabled: !!selectedContainer,
  })

  if (isLoading) {
    return (
      <PodDetailsContainer>
        <PodDetailsHeader title="Pod Details" />
        <PodDetailsContent>
          <div className="w-full py-2 text-sm text-zinc-400/80 flex items-center justify-center h-full">
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
            <div className="bg-zinc-700/10 p-4 rounded-md border border-zinc-700">
              <h2 className="text-lg font-medium text-zinc-300 mb-3">Metadata</h2>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <span className="text-zinc-400/70">Namespace:</span>
                  <span className="text-zinc-300 text-right">{pod.metadata?.namespace || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <span className="text-zinc-400/70">Created:</span>
                  <span className="text-zinc-300 text-right">
                    {pod.metadata?.creationTimestamp
                      ? new Date(pod.metadata.creationTimestamp).toLocaleString()
                      : 'N/A'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <span className="text-zinc-400/70">UID:</span>
                  <span className="text-zinc-300 text-right">{pod.metadata?.uid || 'N/A'}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-700/10 p-4 rounded-md border border-zinc-700">
              <h2 className="text-lg font-medium text-zinc-300 mb-3">Status</h2>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <span className="text-zinc-400/70">Phase:</span>
                  <span className="text-zinc-300 text-right">{pod.status?.phase || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <span className="text-zinc-400/70">Pod IP:</span>
                  <span className="text-zinc-300 text-right">{pod.status?.podIp || 'N/A'}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <span className="text-zinc-400/70">Host IP:</span>
                  <span className="text-zinc-300 text-right">{pod.status?.hostIp || 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-zinc-700/10 p-4 rounded-md border border-zinc-700 mb-6">
            <h2 className="text-lg font-medium text-zinc-300 mb-3">Spec</h2>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <span className="text-zinc-400/70">Node Name:</span>
                <span className="text-zinc-300 text-right">{pod.spec?.nodeName || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <span className="text-zinc-400/70">Restart Policy:</span>
                <span className="text-zinc-300 text-right">{pod.spec?.restartPolicy || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <span className="text-zinc-400/70">Service Account:</span>
                <span className="text-zinc-300 text-right">{pod.spec?.serviceAccountName || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <span className="text-zinc-400/70">DNS Policy:</span>
                <span className="text-zinc-300 text-right">{pod.spec?.dnsPolicy || 'N/A'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <span className="text-zinc-400/70">Priority:</span>
                <span className="text-zinc-300 text-right">
                  {pod.spec?.priority !== undefined ? pod.spec.priority : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {pod.spec?.containers && (
            <div className="bg-zinc-700/10 p-4 rounded-md border border-zinc-700">
              <h2 className="text-lg font-medium text-zinc-300 mb-3">Containers</h2>
              <div className="space-y-4">
                {pod.spec.containers.map((container: Container) => (
                  <div key={container.name} className="bg-zinc-700/10 p-4 rounded-md border border-zinc-700">
                    <h3 className="text-md font-medium text-zinc-300 mb-2">{container.name}</h3>
                    <div className="space-y-2">
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-4">
                          <span className="text-zinc-400/70">Image:</span>
                          <span className="text-zinc-300 text-right">{container.image || 'N/A'}</span>
                        </div>
                        {container.ports && container.ports.length > 0 && (
                          <div>
                            <span className="text-zinc-400/70">Ports:</span>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {container.ports.map((port: ContainerPort) => (
                                <span
                                  key={`${port.containerPort}-${port.protocol || 'TCP'}`}
                                  className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400/80"
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
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-zinc-700/10 p-4 rounded-md border border-zinc-700 mt-6">
            <h2 className="text-lg font-medium text-zinc-300 mb-3">Logs</h2>

            {pod?.spec?.containers && pod.spec.containers.length > 0 ? (
              <div>
                <div className="flex border-b border-zinc-700 mb-4">
                  {pod.spec.containers.map((container: Container) => (
                    <button
                      key={container.name}
                      type="button"
                      onClick={() => setSelectedContainer(container.name)}
                      className={`px-4 py-2 text-sm font-medium ${
                        selectedContainer === container.name
                          ? 'text-zinc-200 border-b-2 border-zinc-400 -mb-px'
                          : 'text-zinc-400/70 hover:text-zinc-300'
                      }`}
                    >
                      {container.name}
                    </button>
                  ))}
                </div>

                {!selectedContainer ? (
                  <div className="text-zinc-400/80">Select a container to view logs</div>
                ) : isLoadingLogs ? (
                  <div className="text-zinc-400/80 py-4">Loading logs...</div>
                ) : logsError ? (
                  <div className="text-red-400 py-4">
                    {logsError instanceof Error ? logsError.message : 'Failed to load logs'}
                  </div>
                ) : (
                  <LogViewer logs={logs} />
                )}
              </div>
            ) : (
              <div className="text-zinc-400/80">No containers found</div>
            )}
          </div>
        </div>
      </PodDetailsContent>
    </PodDetailsContainer>
  )
}
