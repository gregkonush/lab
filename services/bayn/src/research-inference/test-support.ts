import { Result } from 'effect'
import { sha256 } from '../hash'
import {
  alphaCheckpoint,
  alphaModel,
  decodeResearchRun,
  harnessEditorCheckpoint,
  harnessEditorModel,
  HarnessPurpose,
} from './contract'

export const researchFixture = () => {
  const run = Result.getOrThrow(
    decodeResearchRun({
      schemaVersion: 'bayn.research-run.v1',
      sourceRevision: 'a'.repeat(40),
      studyHash: 'b'.repeat(64),
      armManifestHashes: ['c'.repeat(64)],
      captureManifestHash: 'd'.repeat(64),
      featureCutoff: '1970-01-01T00:00:00.000Z',
      registeredAt: '1970-01-01T00:00:00.000Z',
      deadlineAt: '1970-01-01T00:00:30.000Z',
      attempt: 0,
      promptTemplate: 'Select factors using the supplied semantic descriptions.',
      context: {
        producerManifestHash: 'e'.repeat(64),
        preparationAttemptHashes: ['f'.repeat(64)],
        memory: {
          sha256: sha256('synthetic memory'),
          text: 'synthetic memory',
          availableAt: '1970-01-01T00:00:00.000Z',
        },
        factors: [
          {
            id: 'alpha001',
            formulaHash: '1'.repeat(64),
            implementationRevision: '2'.repeat(40),
            performance: {
              sha256: '3'.repeat(64),
              availableAt: '1970-01-01T00:00:00.000Z',
              labelsMaturedAt: '1970-01-01T00:00:00.000Z',
            },
            description: 'synthetic factor description',
            descriptionHash: sha256('synthetic factor description'),
            availableAt: '1970-01-01T00:00:00.000Z',
          },
        ],
      },
      policy: {
        model: alphaModel,
        checkpoint: alphaCheckpoint,
        servingImage: 'sha256:7ef5a35d1ef8ce2cf9d671dd91eec6e367c5849262e0362b4d3d4a26be0d87d2',
        tokenizerRevision: alphaCheckpoint,
        chatTemplateRevision: alphaCheckpoint,
        temperature: 0,
        top_p: 0.7,
        top_k: -1,
        min_p: 0,
        seed: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
        repetition_penalty: 1,
        enable_thinking: true,
        max_tokens: 4096,
        stop: [],
        maximumFactors: 1,
      },
      costBasis: {
        sourceEvidenceHash: '4'.repeat(64),
        effectiveFrom: '1970-01-01T00:00:00.000Z',
        effectiveUntil: '1970-01-02T00:00:00.000Z',
        allocation: 'reserved-capacity-wall-time',
        picoUsdPerSecond: '1000000001',
      },
    }),
  )
  if (run.schemaVersion !== 'bayn.research-run.v1') throw new Error('Invalid factor fixture')
  return run
}
export const harnessEditorFixture = () => {
  const historical = researchFixture()
  const { maximumFactors: _historicalLimit, ...policy } = historical.policy
  const run = Result.getOrThrow(
    decodeResearchRun({
      ...historical,
      schemaVersion: 'bayn.jev-harness2-editor.v3',
      purpose: HarnessPurpose.PromptEdit,
      promptTemplate: 'Revise only the Jev conditional plan instruction using the supplied development evidence.',
      context: { memory: historical.context.memory },
      policy: {
        ...policy,
        model: harnessEditorModel,
        checkpoint: harnessEditorCheckpoint,
        tokenizerRevision: harnessEditorCheckpoint,
        chatTemplateRevision: harnessEditorCheckpoint,
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        enable_thinking: false,
      },
    }),
  )
  if (run.schemaVersion !== 'bayn.jev-harness2-editor.v3') throw new Error('Invalid editor fixture')
  return run
}

export const streamFixture = (content = '<alpha_list>alpha001</alpha_list>', model: string = alphaModel) =>
  [
    {
      id: 'chatcmpl-synthetic',
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    },
    {
      id: 'chatcmpl-synthetic',
      model,
      choices: [{ index: 0, delta: { reasoning: 'thinking' }, finish_reason: null }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    },
    {
      id: 'chatcmpl-synthetic',
      model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
      usage: { prompt_tokens: 10, completion_tokens: 19, total_tokens: 29 },
    },
    {
      id: 'chatcmpl-synthetic',
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    },
    {
      id: 'chatcmpl-synthetic',
      model,
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join('') + 'data: [DONE]\n\n'

export const fullTokenBudgetStreamFixture = (
  model: string = alphaModel,
  content = '<alpha_list>alpha001</alpha_list>',
) => {
  const chunk = (completion: number, delta: Record<string, string>, finish: string | null = null) => ({
    id: 'chatcmpl-synthetic',
    object: 'chat.completion.chunk',
    created: 1791792592,
    model,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finish, token_ids: null }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: completion,
      total_tokens: 10 + completion,
      completion_tokens_details: { reasoning_tokens: Math.min(completion, 4095) },
    },
  })
  return (
    [
      chunk(0, { role: 'assistant', content: '' }),
      ...Array.from({ length: 4095 }, (_, index) => chunk(index + 1, { reasoning: ' test' })),
      chunk(4096, { content }, 'stop'),
      { ...chunk(4096, {}), choices: [] },
    ]
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  )
}
