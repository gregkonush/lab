import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Clock, Config, Effect, FileSystem, Layer, Logger, Schema, Stdio, Stream } from 'effect'

import { embeddedBuildMetadata } from './build'
import { canonicalHashV1Result } from './hash'
import { JevClient, JevClientLive } from './jev/client'
import { JevContractError } from './jev/contract'
import { JevHttpClientLive } from './jev/http'
import { jevInstructions } from './jev/instructions'
import { jevHarnessDecision, prepareJevHarnessProbe, verifyJevHarnessReceipt } from './jev/harness2'

export const harness2CommandUsage =
  'Usage: bayn-harness2-probe --baseline | --validate <run.json> | --run <run.json> --output <new-receipt.json> | --verify <run.json> --receipt <receipt.json> | --help'

export const harness2Command = (args: readonly string[]) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    const print = (value: unknown) =>
      Stream.run(
        Stream.make(new TextEncoder().encode(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`)),
        stdio.stdout(),
      )
    if (args.length === 1 && args[0] === '--help') return yield* print(harness2CommandUsage)
    if (args.length === 1 && args[0] === '--baseline') return yield* print(jevInstructions)
    const path = args[1]
    if (
      path === undefined ||
      !(
        (args.length === 2 && args[0] === '--validate') ||
        (args.length === 4 &&
          ((args[0] === '--run' && args[2] === '--output') || (args[0] === '--verify' && args[2] === '--receipt')))
      )
    )
      return yield* new JevContractError({ message: harness2CommandUsage })
    const fs = yield* FileSystem.FileSystem
    if ((yield* fs.stat(path)).size > 16n * 1024n * 1024n)
      return yield* new JevContractError({ message: 'Harness probe exceeds 16 MiB' })
    const prepared = yield* Effect.fromResult(
      prepareJevHarnessProbe(
        yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(yield* fs.readFileString(path)),
      ),
    )
    if (embeddedBuildMetadata !== undefined && prepared.run.sourceRevision !== embeddedBuildMetadata.sourceRevision)
      return yield* new JevContractError({ message: 'Harness probe source differs from its installed image' })
    if (args[0] === '--validate') {
      if (
        (yield* Effect.fromResult(canonicalHashV1Result(prepared.run.instructions))) !==
        (yield* Effect.fromResult(canonicalHashV1Result(jevInstructions)))
      )
        return yield* new JevContractError({
          message: 'Study baseline differs from the compiled live Jev instructions',
        })
      return yield* print({
        runId: prepared.runId,
        observationHash: prepared.observation.contentHash,
        requests: prepared.requests.length,
        baseline: jevInstructions,
        qualification: 'UNQUALIFIED',
      })
    }
    const output = args[3]
    if (output === undefined) return yield* new JevContractError({ message: harness2CommandUsage })
    if (args[0] === '--verify') {
      const receipt = yield* Effect.fromResult(
        verifyJevHarnessReceipt(
          prepared.run,
          yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(yield* fs.readFileString(output)),
        ),
      )
      return yield* print({ runId: receipt.runId, receiptHash: receipt.receiptHash, outcome: receipt.outcome })
    }
    // A durable outer reservation forbids retry; this local claim also rejects accidental duplicate invocation.
    yield* fs.writeFileString(`${output}.claim`, prepared.runId, { flag: 'wx', mode: 0o600 })
    const startedAtMs = yield* Clock.currentTimeMillis
    if (startedAtMs < Date.parse(prepared.run.registeredAt) || startedAtMs >= Date.parse(prepared.run.deadlineAt))
      return yield* new JevContractError({ message: 'Harness probe is outside its registered window' })
    const key = yield* Config.Redacted('BAYN_JEV_API_KEY')
    const proxy = yield* Config.NonEmptyString('BAYN_PUBLIC_INFORMATION_PROXY')
    const results = yield* Effect.gen(function* () {
      const client = yield* JevClient
      return yield* Effect.forEach(
        prepared.requests,
        (request) =>
          Effect.gen(function* () {
            const result = yield* client.evaluate(request.request).pipe(Effect.result)
            const value = { symbol: request.symbol, requestHash: request.requestHash, result }
            yield* fs.writeFileString(`${output}.${request.symbol.replaceAll('/', '_')}.json`, JSON.stringify(value), {
              flag: 'wx',
              mode: 0o600,
            })
            return { ...request, result }
          }),
        { concurrency: 1 },
      )
    }).pipe(
      Effect.timeout(`${Math.max(1, Date.parse(prepared.run.deadlineAt) - startedAtMs)} millis`),
      // @effect-diagnostics-next-line strictEffectProvide:off -- bounded research command owns its provider client
      Effect.provide(JevClientLive(key, 10_000).pipe(Layer.provide(JevHttpClientLive(proxy)))),
    )
    const inferences = results.flatMap(({ symbol, result }) =>
      result._tag === 'Success' ? [{ symbol, inference: result.success }] : [],
    )
    const decision =
      inferences.length === results.length ? yield* Effect.fromResult(jevHarnessDecision(prepared, inferences)) : null
    const material = {
      schemaVersion: 'bayn.jev-harness2-receipt.v1',
      runId: prepared.runId,
      sourceRevision: prepared.run.sourceRevision,
      observationHash: prepared.observation.contentHash,
      instructionsHash: yield* Effect.fromResult(canonicalHashV1Result(prepared.run.instructions)),
      startedAtMs,
      completedAtMs: yield* Clock.currentTimeMillis,
      outcome: decision === null ? 'INCONCLUSIVE' : 'COMPLETE',
      requests: results.map(({ symbol, originalRequestHash, request, requestHash, result }) => ({
        symbol,
        originalRequestHash,
        request,
        requestHash,
        inference: result._tag === 'Success' ? result.success : null,
        failure: result._tag === 'Failure' ? result.failure.failure : null,
      })),
      decision,
      costPicoUsd: null,
      qualification: 'UNQUALIFIED',
      timingQualification: 'OFFLINE_REEVALUATION',
    }
    const receipt = { ...material, receiptHash: yield* Effect.fromResult(canonicalHashV1Result(material)) }
    yield* Effect.fromResult(verifyJevHarnessReceipt(prepared.run, receipt))
    yield* fs.writeFileString(output, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
    return yield* print({ runId: prepared.runId, outcome: receipt.outcome, receiptHash: receipt.receiptHash })
  })

if (import.meta.main)
  NodeRuntime.runMain(
    harness2Command(process.argv.slice(2)).pipe(
      // @effect-diagnostics-next-line strictEffectProvide:off -- CLI entry point owns files and logging
      Effect.provide(Layer.mergeAll(NodeServices.layer, Logger.layer([Logger.withConsoleError(Logger.formatJson)]))),
    ),
  )
