# TS Core Bridge Implementation Guide

**Audience:** Codex engineers extending the Bun-native Temporal SDK  
**Prereqs:** `ffi-surface.md` should already be in flight; native exports must exist before these steps.  
**Objective:** Replace the re-export of `@temporalio/core-bridge` with a Bun-specific implementation that speaks to the new FFI surface.

---

## 1. File Layout

```
src/
  core-bridge/
    index.ts              // Public surface
    runtime.ts            // Runtime helpers
    client.ts             // Client commands
    worker.ts             // Worker driver
    errors.ts             // Bridge error types (mirrors upstream)
  internal/core-bridge/
    native.ts             // FFI wiring (already present)
```

---

## 2. Public API Shape

Match the upstream Core SDK interface so existing higher-level code remains compatible:

```ts
export interface Runtime {
  shutdown(): Promise<void>
  configureTelemetry(options: TelemetryOptions): Promise<void>
  setLogger(callback: LogCallback): void
}

export interface Client {
  startWorkflow(request: StartWorkflowRequest): Promise<StartWorkflowResponse>
  signalWorkflow(request: SignalWorkflowRequest): Promise<void>
  queryWorkflow(request: QueryWorkflowRequest): Promise<QueryWorkflowResponse>
  terminateWorkflow(request: TerminateWorkflowRequest): Promise<void>
  updateHeaders(headers: Record<string, string>): Promise<void>
}

export interface Worker {
  run(): Promise<void>
  shutdown(gracefulTimeoutMs?: number): Promise<void>
  recordActivityHeartbeat(heartbeat: ActivityHeartbeatRequest): Promise<void>
}
```

The `index.ts` file should export constructors:

```ts
export const createRuntime = (options?: RuntimeOptions) => new RuntimeImpl(...)
export const createClient = (runtime: Runtime, config: ClientConfig) => new ClientImpl(...)
export const createWorker = (runtime: Runtime, client: Client, config: WorkerConfig) => new WorkerImpl(...)
```

---

## 3. Responsibilities

| Component | Duties |
|-----------|--------|
| `RuntimeImpl` | Own the native runtime pointer, call telemetry/logging FFI, manage shutdown semantics, surface diagnostics. |
| `ClientImpl` | Serialize requests into the JSON/byte payloads expected by FFI, decode responses, expose ergonomic helpers to higher layers. |
| `WorkerImpl` | Provide async iteration over poll calls, internally run the workflow/activity loops, handle shutdown states, translate heartbeats. |
| `errors.ts` | Define `TemporalBridgeError` with `.code`, `.details`, `.retryable` derived from FFI error strings. |

---

## 4. Implementation Steps

1. **Create runtime wrapper.**
   - Store native handle (number).
   - Provide `configureTelemetry` and `setLogger` passthroughs.
   - Use `FinalizationRegistry` to guard against leaks.

2. **Client commands.**
   - Build `requestToPayload` utilities that encode headers, search attributes, retry options.
   - Use `byteArrayFromPointer` helper for responses.
   - Validate response shapes with Zod.

3. **Worker driver.**
   - Accept configuration (task queue, max concurrent pollers, interceptors).
   - Internally share event emitters for workflow/activity poll loops.
   - Provide `run()` that:
     1. Spins up poll loops via `Promise.allSettled`.
     2. Dispatches tasks to workflow/activity runtime modules (implemented separately).
     3. Observes shutdown signals.

4. **Error handling.**
   - Wrap every call with `convertError(nativeCall, contextLabel)`.
   - Provide `TemporalBridgeError.isRetryable()` hint to consumer.

5. **Dependencies.**
   - Use only standard library plus small utilities (Zod optional).
   - Avoid re-importing upstream Temporal packages.

---

## 5. Acceptance Criteria

- `src/core-bridge/index.ts` no longer references `vendor/sdk-typescript`.
- All FFI interactions routed through `internal/core-bridge/native.ts`.
- Unit tests cover runtime, client, and worker constructors (see `testing-plan.md`).
- `pnpm --filter @proompteng/temporal-bun-sdk build` succeeds without `@temporalio/core-bridge`.
- Documentation updated in README once shipped.

Keep this doc synchronized with any future FFI adjustments.
