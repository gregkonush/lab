import { Result } from 'effect'

import { canonicalHashV1Result } from '../hash'
import { decodeJevResponse, jevModel, prepareJevRequest, type JevResponse } from './contract'

export const tradingSignalInferenceFixture = (input: unknown, at: string) => {
  const { request } = Result.getOrThrow(prepareJevRequest(input))
  const response = {
    model: jevModel,
    answers: {
      action: {
        type: 'choice',
        choice: 'enter',
        confidence: 0.8,
        probabilities: { enter: 0.8, wait: 0.1, avoid: 0.1 },
      },
    },
    usage: { input_tokens: 250, output_tokens: 80 },
  } satisfies JevResponse
  Result.getOrThrow(decodeJevResponse(request, response))
  return {
    requestHash: Result.getOrThrow(canonicalHashV1Result(request)),
    responseHash: Result.getOrThrow(canonicalHashV1Result(response)),
    startedAt: at,
    completedAt: at,
    response,
  }
}
