import { canonicalHashV1 } from '../hash'
import { nativeJevInference } from './native.test-support'

export const tradingSignalInferenceFixture = (input: unknown, at: string) => {
  const inferred = nativeJevInference(input, at)
  const response = { ...inferred.response, usage: { input_tokens: 250, output_tokens: 80 } }
  return { ...inferred, responseHash: canonicalHashV1(response), response }
}
