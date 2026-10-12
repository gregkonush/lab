import { Effect, Schema, Stream } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { decodeResearchRun, hashResearch, ResearchError, ResearchReceiptSchema } from './contract'
import { verifyResearchReceipt } from './store'

export const submitResearch = Effect.fn('bayn.research.submit')(
  function* (input: unknown, origin: string) {
    const run = yield* Effect.fromResult(decodeResearchRun(input))
    const runId = yield* Effect.fromResult(hashResearch(run))
    const url = yield* Effect.try({
      try: () => new URL(origin),
      catch: (cause) => new ResearchError({ message: 'Restate research origin is invalid', cause }),
    })
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    )
      return yield* new ResearchError({ message: 'Restate research origin must be an uncredentialed HTTP(S) origin' })
    const http = yield* HttpClient.HttpClient
    const initial = yield* http.execute(
      HttpClientRequest.post(`${url.origin}/restate/call/BaynResearchRun/${runId}/run`).pipe(
        HttpClientRequest.bodyText(JSON.stringify(run), 'application/json'),
      ),
    )
    const response =
      initial.status === 409
        ? yield* http.execute(
            HttpClientRequest.post(`${url.origin}/restate/attach`).pipe(
              HttpClientRequest.bodyText(
                JSON.stringify({ target: 'workflow', workflowName: 'BaynResearchRun', workflowKey: runId }),
                'application/json',
              ),
            ),
          )
        : initial
    if (response.status !== 200)
      return yield* new ResearchError({ message: `Research Workflow returned HTTP ${response.status}` })
    let bytes = 0
    const chunks = yield* response.stream.pipe(
      Stream.runFoldEffect(
        (): Uint8Array[] => [],
        (chunks, chunk) => {
          bytes += chunk.length
          return bytes > 786432
            ? Effect.fail(new ResearchError({ message: 'Research Workflow response exceeds 768 KiB' }))
            : Effect.succeed([...chunks, chunk])
        },
      ),
    )
    const text = Buffer.concat(chunks).toString('utf8')
    const receipt = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ResearchReceiptSchema))(text)
    return yield* Effect.fromResult(verifyResearchReceipt(run, receipt))
  },
  Effect.scoped,
  Effect.timeout('195 seconds'),
)
