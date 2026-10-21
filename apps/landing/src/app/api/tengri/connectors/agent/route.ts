import { z } from 'zod'
import { relayCall } from '@/lib/tengri/relay'
import { noStoreHeaders, readTengriJsonBody } from '@/lib/tengri/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const grantId = z.uuid().parse(request.headers.get('x-tengri-grant'))
    const credential = z
      .string()
      .regex(/^DPoP [a-zA-Z0-9_-]{43}$/)
      .parse(request.headers.get('authorization'))
      .slice(5)
    const proof = z.string().min(1).max(16384).parse(request.headers.get('dpop'))
    // Keep these exact bytes: the DPoP proof also signs their SHA-256 digest.
    const payload = z
      .object({ body: z.string().min(1).max(1_398_104) })
      .strict()
      .parse(await readTengriJsonBody(request, { subject: grantId, maxBytes: 1_398_200 }))
    return Response.json(
      await relayCall(
        { action: 'agentInvoke', grantId, credential, proof, body: payload.body },
        undefined,
        request.signal,
      ),
      { headers: noStoreHeaders() },
    )
  } catch {
    return Response.json(
      { error: 'The connector grant, proof, or operation was denied.' },
      { status: 403, headers: noStoreHeaders() },
    )
  }
}
