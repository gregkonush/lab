import { expect, test } from 'bun:test'
import { Effect, Redacted, Result } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'

import { maximumResearchReceiptBytes } from './contract'
import { submitResearch } from './submission'
import { researchFixture } from './test-support'

test('bounds the serialized Workflow receipt before decoding it', async () => {
  const http = HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response(new Uint8Array(maximumResearchReceiptBytes + 1)))),
  )
  const result = await Effect.runPromise(
    submitResearch(researchFixture(), 'http://fixture.invalid', Redacted.make('7'.repeat(64))).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.result,
    ),
  )
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) expect(result.failure.message).toBe('Research Workflow response exceeds 5 MiB')
})
