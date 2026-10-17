'use client'

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isWorkspaceImagePath } from '@/lib/tengri/codex-images'
import { runTengriAction } from './client'
import { finderCanPreviewText } from './finder-model'
import { parseWorkspaceFileLink } from './workspace-file-link-model'

type FileTarget = NonNullable<ReturnType<typeof parseWorkspaceFileLink>>
const WorkspaceFileLinkContext = createContext<((file: FileTarget) => void) | null>(null)
const WorkspaceAgentContext = createContext<string | null>(null)
const MAX_PREVIEW_CHARACTERS = 200_000
const MAX_PREVIEW_LINES = 5_000

export function WorkspaceFileLinkProvider({
  agentId,
  children,
  conversationId,
}: {
  agentId: string
  children?: ReactNode
  conversationId?: string
}) {
  const [files, setFiles] = useState<FileTarget[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const id = useId()
  const activeFile = files.find((file) => file.path === activePath)
  useEffect(() => {
    setActivePath(null)
  }, [conversationId])
  useEffect(() => {
    if (activePath)
      document.getElementById(`${id}-file-${files.findIndex((file) => file.path === activePath)}`)?.focus()
  }, [activePath, files, id])
  const openFile = (file: FileTarget) => {
    setFiles((current) => [...current.filter((item) => item.path !== file.path), file])
    setActivePath(file.path)
  }
  const closeFile = (path: string) => {
    setFiles((current) => current.filter((file) => file.path !== path))
    if (activePath === path) {
      setActivePath(null)
      document.getElementById(`${id}-chat`)?.focus()
    }
  }
  return (
    <WorkspaceFileLinkContext.Provider value={openFile}>
      <WorkspaceAgentContext.Provider value={agentId}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            role="tablist"
            aria-label="Agent views"
            className="flex shrink-0 overflow-x-auto border-b border-zinc-800 bg-zinc-950"
            onKeyDown={(event) => {
              if (event.key === 'Delete' && activePath) {
                event.preventDefault()
                closeFile(activePath)
                return
              }
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
              const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
              event.preventDefault()
              tabs[next]?.focus()
              tabs[next]?.click()
            }}
          >
            <button
              role="tab"
              id={`${id}-chat`}
              aria-controls={`${id}-chat-panel`}
              aria-selected={!activeFile}
              tabIndex={activeFile ? -1 : 0}
              type="button"
              onClick={() => setActivePath(null)}
              className={`shrink-0 border-b-2 px-4 py-2 text-label-12 ${!activeFile ? 'border-blue-400 text-zinc-100' : 'border-transparent text-zinc-400'}`}
            >
              Chat
            </button>
            {files.map((file, index) => (
              <div
                key={file.path}
                className={`flex shrink-0 items-center border-b-2 ${activePath === file.path ? 'border-blue-400 text-zinc-100' : 'border-transparent text-zinc-400'}`}
              >
                <button
                  role="tab"
                  id={`${id}-file-${index}`}
                  aria-controls={`${id}-file-panel-${index}`}
                  aria-selected={activePath === file.path}
                  tabIndex={activePath === file.path ? 0 : -1}
                  title={file.path}
                  type="button"
                  onClick={() => setActivePath(file.path)}
                  className="max-w-56 truncate px-3 py-2 text-label-12"
                >
                  {file.path.split('/').at(-1)}
                </button>
              </div>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${id}-chat-panel`}
            aria-labelledby={`${id}-chat`}
            hidden={Boolean(activeFile)}
            className={activeFile ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}
          >
            {children}
          </div>
          {files.map((file, index) => (
            <div
              key={file.path}
              role="tabpanel"
              id={`${id}-file-panel-${index}`}
              aria-labelledby={`${id}-file-${index}`}
              hidden={activePath !== file.path}
              className={activePath === file.path ? 'min-h-0 flex-1' : 'hidden'}
            >
              {activePath === file.path ? (
                <FilePreview
                  key={`${agentId}:${file.path}:${file.line}:${file.column}`}
                  agentId={agentId}
                  file={file}
                  onClose={() => closeFile(file.path)}
                />
              ) : null}
            </div>
          ))}
        </div>
      </WorkspaceAgentContext.Provider>
    </WorkspaceFileLinkContext.Provider>
  )
}

function FilePreview({ agentId, file, onClose }: { agentId: string; file: FileTarget; onClose: () => void }) {
  const [result, setResult] = useState<{ content: string; contentType: string } | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [source, setSource] = useState(false)
  const selectedLine = useRef<HTMLSpanElement>(null)
  const markdown = /\.(md|markdown|mdown)$/i.test(file.path)
  const image = isWorkspaceImagePath(file.path)
  useEffect(() => {
    if (image) return
    const controller = new AbortController()
    setResult(null)
    setError('')
    void runTengriAction<{ content: string; contentType: string }>(
      { action: 'read-file', agentId, path: file.path },
      controller.signal,
    )
      .then((value) => {
        if (controller.signal.aborted) return
        if (!finderCanPreviewText(value.contentType)) throw new Error('This file type cannot be previewed as text.')
        setResult(value)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not read this file.')
      })
    return () => controller.abort()
  }, [agentId, file.path, attempt, image])
  useEffect(() => {
    selectedLine.current?.scrollIntoView({ block: 'nearest' })
  }, [result, source])
  const content = result?.content.slice(0, MAX_PREVIEW_CHARACTERS) ?? ''
  const lines = content.split('\n')
  const truncated =
    (result?.content.length ?? 0) > MAX_PREVIEW_CHARACTERS ||
    ((source || !markdown) && lines.length > MAX_PREVIEW_LINES)
  const showSource = source || !markdown
  return (
    <section
      aria-label="File preview"
      className="flex h-full min-h-0 flex-col border-t border-zinc-700 bg-zinc-950 text-copy-14 text-zinc-200"
    >
      <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-label-12" title={file.path}>
          {file.path}
          {file.line ? `:${file.line}${file.column ? `:${file.column}` : ''}` : ''}
        </h2>
        {markdown ? (
          <button type="button" className="shrink-0 text-label-12 text-blue-300" onClick={() => setSource(!source)}>
            {source ? 'Rendered' : 'Source'}
          </button>
        ) : null}
        <button type="button" aria-label={`Close ${file.path}`} className="shrink-0 text-label-12" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="min-h-0 overflow-auto p-3">
        {image ? <WorkspaceImage src={file.path} alt={file.path.split('/').at(-1)} /> : null}
        {!image && !result && !error ? <p role="status">Loading file…</p> : null}
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button type="button" className="mt-2 text-blue-300" onClick={() => setAttempt((value) => value + 1)}>
              Retry file preview
            </button>
          </div>
        ) : null}
        {result ? (
          showSource ? (
            <pre className="text-copy-13-mono">
              <code>
                {lines.slice(0, MAX_PREVIEW_LINES).map((line, index) => (
                  <span
                    key={index}
                    ref={index + 1 === file.line ? selectedLine : undefined}
                    data-selected={index + 1 === file.line ? 'true' : undefined}
                    className={`block min-w-fit ${index + 1 === file.line ? 'bg-blue-500/20' : ''}`}
                  >
                    <span aria-hidden="true" className="mr-4 inline-block w-10 select-none text-right text-zinc-500">
                      {index + 1}
                    </span>
                    {line || ' '}
                    {'\n'}
                  </span>
                ))}
              </code>
            </pre>
          ) : (
            <div className="break-words [&_h1]:my-3 [&_h1]:text-heading-20 [&_h2]:my-3 [&_h2]:text-heading-16 [&_h3]:my-2 [&_h3]:text-heading-14 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:p-3 [&_pre]:bg-zinc-900 [&_code]:font-mono [&_table]:block [&_table]:overflow-auto [&_td]:p-2 [&_th]:p-2 [&_blockquote]:border-l [&_blockquote]:pl-3">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => (
                    <WorkspaceFileLink href={href} basePath={file.path}>
                      {children}
                    </WorkspaceFileLink>
                  ),
                  img: ({ src, alt }) => (
                    <WorkspaceImage src={typeof src === 'string' ? src : undefined} alt={alt} basePath={file.path} />
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          )
        ) : null}
        {truncated ? (
          <p role="status" className="mt-2 text-zinc-400">
            Preview truncated. Only the first {showSource ? '5,000 lines or ' : ''}200,000 characters are shown.
          </p>
        ) : null}
      </div>
    </section>
  )
}

export function WorkspaceFileLink({
  href,
  children,
  basePath,
}: {
  href?: string
  children: ReactNode
  basePath?: string
}) {
  const openFile = useContext(WorkspaceFileLinkContext)
  const file = href ? parseWorkspaceFileLink(href, basePath) : null
  if (file) {
    return (
      <button
        type="button"
        className="inline cursor-pointer break-words text-left text-blue-300 underline decoration-blue-300/40 underline-offset-4 focus-visible:outline focus-visible:outline-blue-400"
        disabled={!openFile}
        title={`Preview ${file.path}${file.line ? `:${file.line}` : ''}`}
        onClick={() => openFile?.(file)}
      >
        {children}
      </button>
    )
  }
  // A malformed local target must never become a request to the desktop website.
  if (!href || !/^(https?:|mailto:)/i.test(href)) return <span>{children}</span>
  return (
    <a href={href} rel="noreferrer noopener" target="_blank">
      {children}
    </a>
  )
}

export function WorkspaceImage({ src, alt, basePath }: { src?: string; alt?: string; basePath?: string }) {
  const agentId = useContext(WorkspaceAgentContext)
  const file = src ? parseWorkspaceFileLink(src, basePath) : null
  const [failedSource, setFailedSource] = useState<string | null>(null)
  if (!agentId || !file || !isWorkspaceImagePath(file.path)) return <span>[Image{alt ? `: ${alt}` : ''}]</span>
  const url = `/api/tengri/attachments?${new URLSearchParams({ agentId, path: file.path })}`
  if (failedSource === url) return <span role="status">Image unavailable{alt ? `: ${alt}` : ''}</span>
  return (
    <img
      src={url}
      alt={alt || file.path.split('/').at(-1) || 'Agent image'}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="my-2 max-h-[32rem] max-w-full rounded-lg object-contain"
      onError={() => setFailedSource(url)}
    />
  )
}
