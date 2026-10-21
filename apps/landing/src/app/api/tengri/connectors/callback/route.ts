import { getTengriIdentity } from '@/lib/tengri/auth'
import { relayCall } from '@/lib/tengri/relay'
import { noStoreHeaders } from '@/lib/tengri/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const target = new URL('/connections', process.env.TENGRI_DESKTOP_ORIGIN || 'https://proompteng.ai')
  try {
    const identity = await getTengriIdentity(request.headers)
    if (!identity || url.searchParams.has('error')) throw new Error('Authorization did not complete')
    const state = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    await relayCall({ action: 'oAuthFinish', state, code }, identity, request.signal)
    target.searchParams.set('connected', '1')
  } catch {
    target.searchParams.set('connectionError', '1')
  }
  const headers = noStoreHeaders()
  headers.set('location', target.toString())
  headers.set('referrer-policy', 'no-referrer')
  return new Response(null, { status: 303, headers })
}
