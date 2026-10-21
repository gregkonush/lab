'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { ConnectorCommand } from '@/lib/tengri/connector-schemas'
import { startTengriSignIn } from '@/lib/tengri/auth-client'

const operationSchema = z.object({
  name: z.string(),
  description: z.string(),
  readOnly: z.boolean(),
  inputSchema: z.json(),
})
const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  authentication: z.enum(['none', 'bearer', 'apiKey', 'oauth2', 'clientCredentials']),
  operations: z.array(operationSchema),
})
const connectionSchema = z.object({
  id: z.uuid(),
  providerId: z.string(),
  name: z.string(),
  status: z.string(),
  version: z.number(),
})
const bindingSchema = z.object({
  connectionId: z.uuid(),
  operations: z.array(z.string()),
  constraints: z.record(z.string(), z.array(z.json())),
})
type Provider = z.infer<typeof providerSchema>
type Connection = z.infer<typeof connectionSchema>
type Binding = z.infer<typeof bindingSchema>
const createSchema = z.object({
  provider: z.string().min(1, 'Choose a service'),
  name: z.string().trim().min(1, 'Enter an account name').max(128),
})
const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus-visible:ring-1 focus-visible:ring-blue-400'
const buttonClass =
  'rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 disabled:opacity-40'

async function command(input: ConnectorCommand, signal?: AbortSignal) {
  const response = await fetch('/api/tengri/connectors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  const value: unknown = await response.json()
  if (!response.ok)
    throw new Error(
      response.status === 428
        ? 'Verify with your passkey, then repeat this change.'
        : z.object({ error: z.string() }).safeParse(value).data?.error ||
            'The connection could not be updated. Try again.',
    )
  return value
}

export function ConnectionsPanel({ workspaceUid, active = true }: { workspaceUid?: string; active?: boolean }) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [bindings, setBindings] = useState<Binding[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const id = useId()
  const pendingCreate = useRef<{ provider: string; name: string; id: string; operationId: string } | null>(null)
  const pendingDisconnects = useRef(new Map<string, string>())
  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { provider: '', name: '' },
  })
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const [catalog, accounts] = await Promise.all([
        command({ action: 'providers' }, signal),
        command({ action: 'list', workspace: workspaceUid }, signal),
      ])
      setProviders(z.object({ providers: z.array(providerSchema) }).parse(catalog).providers)
      const result = z
        .object({ connections: z.array(connectionSchema), bindings: z.array(bindingSchema) })
        .parse(accounts)
      setConnections(result.connections)
      setBindings(result.bindings)
    },
    [workspaceUid],
  )
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setError('')
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Connections are unavailable.')
    })
    return () => controller.abort()
  }, [active, load])
  const perform = async (task: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await task()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The connection could not be updated.')
    } finally {
      setBusy(false)
    }
  }
  const authorize = async (connection: Connection, provider: Provider) => {
    if (provider.authentication === 'oauth2') {
      const result = z
        .object({ authorizationUrl: z.url() })
        .parse(await command({ action: 'oAuthStart', id: connection.id }))
      const url = new URL(result.authorizationUrl)
      if (url.protocol !== 'https:') throw new Error('The provider authorization address is invalid.')
      window.location.assign(url.toString())
    } else if (provider.authentication === 'clientCredentials') {
      await command({ action: 'connectClient', id: connection.id })
    }
  }
  const create = form.handleSubmit((value) =>
    perform(async () => {
      if (
        !pendingCreate.current ||
        pendingCreate.current.provider !== value.provider ||
        pendingCreate.current.name !== value.name
      )
        pendingCreate.current = { ...value, id: crypto.randomUUID(), operationId: crypto.randomUUID() }
      const result = z
        .object({ connection: connectionSchema })
        .parse(await command({ action: 'create', ...pendingCreate.current }))
      pendingCreate.current = null
      form.reset()
      const provider = providers.find((provider) => provider.id === value.provider)
      if (provider) await authorize(result.connection, provider)
    }),
  )
  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-zinc-400">Connect an account once, then choose what each agent can use.</p>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
      {error.includes('passkey') ? (
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void startTengriSignIn(true).catch(() => setError('Passkey verification could not start.'))}
        >
          Verify passkey
        </button>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-zinc-300">
          {notice}
        </p>
      ) : null}
      {connections.map((connection) => {
        const provider = providers.find((provider) => provider.id === connection.providerId)
        const binding = bindings.find((binding) => binding.connectionId === connection.id)
        return (
          <div key={connection.id} className="space-y-3 border-b border-zinc-800 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-zinc-200">{connection.name}</p>
                <p className="text-xs text-zinc-400">
                  {provider?.name || connection.providerId} ·{' '}
                  {connection.status === 'connected'
                    ? 'Connected'
                    : connection.status === 'reconnect'
                      ? 'Reconnect needed'
                      : connection.status === 'disconnected'
                        ? 'Disconnected'
                        : 'Waiting for authorization'}
                </p>
              </div>
              {connection.status !== 'disconnected' ? (
                <button
                  className={buttonClass}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const operationId = pendingDisconnects.current.get(connection.id) || crypto.randomUUID()
                      pendingDisconnects.current.set(connection.id, operationId)
                      const result = z
                        .object({ agentCleanupPending: z.boolean().optional() })
                        .parse(await command({ action: 'disconnect', id: connection.id, operationId }))
                      if (result.agentCleanupPending)
                        setNotice('Disconnected. Agent tools will refresh when the agent is available.')
                      pendingDisconnects.current.delete(connection.id)
                    })
                  }
                >
                  Disconnect
                </button>
              ) : null}
            </div>
            {provider && ['pending', 'reconnect'].includes(connection.status) ? (
              ['bearer', 'apiKey'].includes(provider.authentication) ? (
                <TokenForm
                  connection={connection}
                  busy={busy}
                  save={(token) =>
                    perform(async () => {
                      await command({ action: 'connectToken', id: connection.id, version: connection.version, token })
                    })
                  }
                />
              ) : (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void perform(() => authorize(connection, provider))}
                >
                  Connect account
                </button>
              )
            ) : null}
            {provider && workspaceUid && connection.status === 'connected' ? (
              <OperationForm
                key={`${connection.id}:${JSON.stringify(binding)}`}
                provider={provider}
                binding={binding}
                busy={busy}
                save={(operations, constraints) =>
                  perform(async () => {
                    const result = z.object({ expiresAt: z.string().nullable().optional() }).parse(
                      await command({
                        action: 'bind',
                        id: connection.id,
                        workspace: workspaceUid,
                        operations,
                        constraints,
                      }),
                    )
                    setNotice(
                      result.expiresAt
                        ? `Agent access enabled until ${new Date(result.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Save again to renew it.`
                        : 'Agent access updated.',
                    )
                  })
                }
              />
            ) : null}
          </div>
        )
      })}
      {providers.length ? (
        <form onSubmit={create} className="space-y-2" aria-label="Connect an account">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-provider`} className="mb-1 block text-xs text-zinc-400">
                Service
              </label>
              <select id={`${id}-provider`} {...form.register('provider')} className={inputClass} disabled={busy}>
                <option value="">Choose a service</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              {form.formState.errors.provider ? (
                <p role="alert" className="text-xs text-red-300">
                  {form.formState.errors.provider.message}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor={`${id}-name`} className="mb-1 block text-xs text-zinc-400">
                Account name
              </label>
              <input
                id={`${id}-name`}
                {...form.register('name')}
                className={inputClass}
                disabled={busy}
                autoComplete="off"
              />
              {form.formState.errors.name ? (
                <p role="alert" className="text-xs text-red-300">
                  {form.formState.errors.name.message}
                </p>
              ) : null}
            </div>
          </div>
          <button type="submit" className={buttonClass} disabled={busy}>
            Connect
          </button>
        </form>
      ) : !error ? (
        <p className="text-xs text-zinc-400">No services are configured yet.</p>
      ) : null}
    </div>
  )
}

const tokenSchema = z.object({ token: z.string().min(1, 'Enter the provider credential').max(16384) })
function TokenForm({
  connection,
  busy,
  save,
}: {
  connection: Connection
  busy: boolean
  save: (token: string) => Promise<void>
}) {
  const form = useForm<z.infer<typeof tokenSchema>>({
    resolver: zodResolver(tokenSchema),
    defaultValues: { token: '' },
  })
  const id = useId()
  return (
    <form
      onSubmit={form.handleSubmit(async ({ token }) => {
        try {
          await save(token)
        } finally {
          form.reset()
        }
      })}
      className="flex items-end gap-2"
      aria-label={`Authorize ${connection.name}`}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="mb-1 block text-xs text-zinc-400">
          Provider credential
        </label>
        <input
          id={id}
          type="password"
          autoComplete="off"
          {...form.register('token')}
          className={inputClass}
          disabled={busy}
        />
        {form.formState.errors.token ? (
          <p role="alert" className="text-xs text-red-300">
            {form.formState.errors.token.message}
          </p>
        ) : null}
      </div>
      <button type="submit" className={buttonClass} disabled={busy}>
        Save
      </button>
    </form>
  )
}

const operationsSchema = z.object({
  operations: z.array(z.string()),
  constraints: z.string().refine((value) => {
    try {
      return z.record(z.string().startsWith('/'), z.array(z.json()).min(1)).safeParse(JSON.parse(value)).success
    } catch {
      return false
    }
  }, 'Enter a JSON object of argument paths and allowed values'),
})
function OperationForm({
  provider,
  binding,
  busy,
  save,
}: {
  provider: Provider
  binding?: Binding
  busy: boolean
  save: (operations: string[], constraints: Record<string, z.core.JSONType[]>) => Promise<void>
}) {
  const form = useForm<z.infer<typeof operationsSchema>>({
    resolver: zodResolver(operationsSchema),
    defaultValues: { operations: binding?.operations || [], constraints: JSON.stringify(binding?.constraints || {}) },
  })
  const id = useId()
  return (
    <form
      aria-label={`${provider.name} agent access`}
      onSubmit={form.handleSubmit(({ operations, constraints }) =>
        save(operations, JSON.parse(constraints) as Record<string, z.core.JSONType[]>),
      )}
      className="space-y-2"
    >
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs text-zinc-400">Allowed for this agent</legend>
        {provider.operations.map((operation) => (
          <label key={operation.name} className="flex items-start gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              value={operation.name}
              {...form.register('operations')}
              disabled={busy}
              className="mt-0.5 accent-blue-500"
            />
            <span>
              {operation.description || operation.name}
              {!operation.readOnly ? <span className="ml-1 text-zinc-400">(changes data)</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <details className="text-xs text-zinc-400">
        <summary className="cursor-pointer">Limit resources</summary>
        <label htmlFor={id} className="mt-2 mb-1 block">
          Argument paths and allowed values, for example {`{"/repository":["my-project"]}`}
        </label>
        <textarea id={id} {...form.register('constraints')} rows={2} className={inputClass} disabled={busy} />
        {form.formState.errors.constraints ? (
          <p role="alert" className="text-xs text-red-300">
            {form.formState.errors.constraints.message}
          </p>
        ) : null}
      </details>
      <button type="submit" className={buttonClass} disabled={busy}>
        Save agent access
      </button>
    </form>
  )
}
