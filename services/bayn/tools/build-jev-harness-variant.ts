import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Data, Effect, FileSystem, Path, Schema, Stdio, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { canonicalHashV1Result, sha256 } from '../src/hash'
import { JevInstructionsSchema } from '../src/jev/instructions-contract'
import { jevInstructions } from '../src/jev/instructions'
import { defaultJevProtocolDocument, jevBehaviorHash } from '../src/jev/protocol'
import { GitSourceRevisionSchema, ImageDigestSchema, ImageRepositorySchema, strictParseOptions } from '../src/schemas'

export const JevHarnessVariantSpecSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-harness2-variant.v1'),
  sourceRevision: GitSourceRevisionSchema,
  imageRepository: ImageRepositorySchema,
  baseImageDigest: ImageDigestSchema,
  instructions: JevInstructionsSchema,
})
class VariantBuildError extends Data.TaggedError('VariantBuildError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** One data module is replaced before bundling; every native builder and verifier imports that same module. */
export const jevInstructionsBuildPlugin = (modulePath: string, instructions: typeof JevInstructionsSchema.Type) => {
  let replacements = 0
  const plugin: Bun.BunPlugin = {
    name: 'bayn-jev-frozen-instructions',
    setup: (build) => {
      build.onLoad({ filter: /[/\\]jev[/\\]instructions\.ts$/ }, (file) => {
        if (file.path !== modulePath) return undefined
        replacements++
        return { contents: `export const jevInstructions = ${JSON.stringify(instructions)};\n`, loader: 'ts' }
      })
    },
  }
  return { plugin, replacements: () => replacements }
}

const gitRead = (root: string, args: readonly string[]) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const child = yield* spawner.spawn(ChildProcess.make('git', args, { cwd: root, stdin: 'ignore', stderr: 'ignore' }))
    const [output, status] = yield* Effect.all(
      [child.stdout.pipe(Stream.decodeText(), Stream.mkString), child.exitCode],
      { concurrency: 'unbounded' },
    )
    if (Number(status) !== 0)
      return yield* new VariantBuildError({ message: 'Cannot verify the variant source checkout' })
    return output.trim()
  })
const verifySource = (root: string, expected: string) =>
  Effect.gen(function* () {
    if ((yield* gitRead(root, ['rev-parse', 'HEAD'])) !== expected)
      return yield* new VariantBuildError({ message: 'Variant source revision differs from the checked-out commit' })
    if (
      (yield* gitRead(root, [
        'status',
        '--porcelain',
        '--untracked-files=normal',
        '--',
        'services/bayn',
        'docs/bayn/jev-migration-acceptance-v2.json',
        'bun.lock',
        'package.json',
        'patches',
      ])) !== ''
    )
      return yield* new VariantBuildError({
        message: 'Commit consumed source changes before building a frozen variant',
      })
  })

export const buildJevHarnessVariant = (input: unknown, root: string, outputDirectory: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spec = yield* Schema.decodeUnknownEffect(JevHarnessVariantSpecSchema, strictParseOptions)(input)
      if (Bun.version !== '1.4.2')
        return yield* new VariantBuildError({ message: 'Variant builds require the pinned Bun 1.4.2 toolchain' })
      yield* verifySource(root, spec.sourceRevision)
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const instructions = jevInstructionsBuildPlugin(
        path.join(root, 'services/bayn/src/jev/instructions.ts'),
        spec.instructions,
      )
      const parameterHash = yield* Effect.fromResult(canonicalHashV1Result(defaultJevProtocolDocument))
      yield* fs.makeDirectory(outputDirectory, { mode: 0o700 })
      // Bun's build API has no cancellation handle. Await its bounded local build before allowing interruption.
      const result = yield* Effect.uninterruptible(
        Effect.tryPromise({
          try: () =>
            Bun.build({
              entrypoints: [path.join(root, 'services/bayn/src/backtest-command.ts')],
              target: 'node',
              external: ['tigerbeetle-node', '@platformatic/kafka'],
              plugins: [instructions.plugin],
              define: {
                __BAYN_BUILD_SOURCE_REVISION__: JSON.stringify(spec.sourceRevision),
                __BAYN_BUILD_IMAGE_REPOSITORY__: JSON.stringify(spec.imageRepository),
                __BAYN_BUILD_STRATEGY_BEHAVIOR_HASH__: JSON.stringify(jevBehaviorHash),
                __BAYN_BUILD_STRATEGY_PARAMETER_HASH__: JSON.stringify(parameterHash),
              },
            }),
          catch: (cause) => new VariantBuildError({ message: 'Native variant compilation failed', cause }),
        }),
      )
      if (!result.success || result.outputs.length !== 1 || instructions.replacements() !== 1)
        return yield* new VariantBuildError({
          message: 'Variant must compile one native executable and replace one instruction document',
          cause: result.logs,
        })
      yield* verifySource(root, spec.sourceRevision)
      const output = result.outputs[0]
      if (output === undefined) return yield* new VariantBuildError({ message: 'Native variant executable is missing' })
      const bytes = new Uint8Array(
        yield* Effect.tryPromise({
          try: () => output.arrayBuffer(),
          catch: (cause) => new VariantBuildError({ message: 'Cannot read native variant bytes', cause }),
        }),
      )
      yield* fs.writeFile(path.join(outputDirectory, 'backtest.js'), bytes, { flag: 'wx', mode: 0o600 })
      yield* fs.symlink(path.join(root, 'services/bayn/node_modules'), path.join(outputDirectory, 'node_modules'))
      const material = {
        schemaVersion: 'bayn.jev-harness2-variant-build.v1',
        spec,
        baselineInstructionsHash: yield* Effect.fromResult(canonicalHashV1Result(jevInstructions)),
        instructionsHash: yield* Effect.fromResult(canonicalHashV1Result(spec.instructions)),
        strategyBehaviorHash: jevBehaviorHash,
        strategyParameterHash: parameterHash,
        executableSha256: sha256(bytes),
        bunVersion: Bun.version,
        replacedSourceModule: 'services/bayn/src/jev/instructions.ts',
        sourceVerification: 'CLEAN_COMMITTED_BUILD_INPUTS',
        baseImageVerification: 'REQUIRES_RUNTIME_READBACK',
        qualification: 'UNQUALIFIED',
      }
      const receipt = { ...material, receiptHash: yield* Effect.fromResult(canonicalHashV1Result(material)) }
      yield* fs.writeFileString(path.join(outputDirectory, 'build.json'), JSON.stringify(receipt), {
        flag: 'wx',
        mode: 0o600,
      })
      return receipt
    }),
  )

if (import.meta.main)
  NodeRuntime.runMain(
    Effect.gen(function* () {
      const args = process.argv.slice(2)
      const specPath = args[1],
        outputPath = args[3]
      if (
        args.length !== 4 ||
        args[0] !== '--spec' ||
        args[2] !== '--output' ||
        specPath === undefined ||
        outputPath === undefined
      )
        return yield* new VariantBuildError({
          message: 'Usage: bun tools/build-jev-harness-variant.ts --spec <variant.json> --output <new-directory>',
        })
      const fs = yield* FileSystem.FileSystem
      if ((yield* fs.stat(specPath)).size > 65536n)
        return yield* new VariantBuildError({ message: 'Variant specification exceeds 64 KiB' })
      const spec = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
        yield* fs.readFileString(specPath),
      )
      const path = yield* Path.Path
      const receipt = yield* buildJevHarnessVariant(
        spec,
        path.resolve(import.meta.dir, '../../..'),
        path.resolve(outputPath),
      )
      const stdio = yield* Stdio.Stdio
      yield* Stream.run(Stream.make(JSON.stringify(receipt) + '\n'), stdio.stdout())
    }).pipe(
      // @effect-diagnostics-next-line strictEffectProvide:off -- compiler command owns files and child processes
      Effect.provide(NodeServices.layer),
    ),
  )
