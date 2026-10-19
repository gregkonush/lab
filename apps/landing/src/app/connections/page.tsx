import { headers } from 'next/headers'
import Link from 'next/link'
import { ConnectionsPanel } from '@/components/tengri/connections-panel'
import { getTengriIdentity } from '@/lib/tengri/auth'

export const dynamic = 'force-dynamic'

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const identity = await getTengriIdentity(await headers())
  const status = await searchParams
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-medium">Connections</h1>
          <Link href="/" className="text-sm text-zinc-400 underline">
            Desktop
          </Link>
        </header>
        {status.connected === '1' && (
          <p role="status" className="text-sm text-zinc-300">
            Account connected. Select its operations in the agent’s Settings.
          </p>
        )}
        {status.connectionError === '1' && (
          <p role="alert" className="text-sm text-red-400">
            The account could not be connected. Start authorization again.
          </p>
        )}
        {identity ? <ConnectionsPanel /> : <p>Sign in on the desktop to manage your connections.</p>}
      </div>
    </main>
  )
}
