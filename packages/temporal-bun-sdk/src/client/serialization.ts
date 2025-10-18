import type { SignalWithStartOptions, StartWorkflowOptions, TerminateWorkflowOptions, WorkflowHandle } from './types'

const DOCS_ROOT = 'packages/temporal-bun-sdk/docs'
const FFI_SURFACE_DOC = `${DOCS_ROOT}/ffi-surface.md`
const CLIENT_RUNTIME_DOC = `${DOCS_ROOT}/client-runtime.md`

const notImplemented = (feature: string, docPath: string): never => {
  throw new Error(`${feature} is not implemented yet. See ${docPath} for the step-by-step plan.`)
}

export const buildSignalRequest = (
  handle: WorkflowHandle,
  signalName: string,
  args: unknown[],
): Record<string, unknown> => {
  void handle
  void signalName
  void args
  // TODO(codex): Serialize workflow signal payloads according to ${FFI_SURFACE_DOC} (Client function matrix)
  // and ${CLIENT_RUNTIME_DOC} §3 Request Serialization.
  return notImplemented('Workflow signal serialization', `${DOCS_ROOT}/client-runtime.md`)
}

export const buildQueryRequest = (
  handle: WorkflowHandle,
  queryName: string,
  args: unknown[],
): Record<string, unknown> => {
  void handle
  void queryName
  void args
  // TODO(codex): Encode workflow query payloads and headers per ${CLIENT_RUNTIME_DOC} §3 before invoking the native bridge.
  return notImplemented('Workflow query serialization', CLIENT_RUNTIME_DOC)
}

export const buildTerminateRequest = (
  handle: WorkflowHandle,
  options: TerminateWorkflowOptions,
): Record<string, unknown> => {
  void handle
  void options
  // TODO(codex): Map terminate options into the FFI payload expected by `temporal_bun_client_terminate_workflow`
  // (see ${FFI_SURFACE_DOC}, Client exports table).
  return notImplemented('Workflow terminate serialization', FFI_SURFACE_DOC)
}

export const buildCancelRequest = (handle: WorkflowHandle): Record<string, unknown> => {
  void handle
  // TODO(codex): Emit cancellation payloads for `temporal_bun_client_cancel_workflow` per ${FFI_SURFACE_DOC}.
  return notImplemented('Workflow cancel serialization', FFI_SURFACE_DOC)
}

export const buildSignalWithStartRequest = ({
  options,
  defaults,
}: {
  options: SignalWithStartOptions
  defaults: { namespace: string; identity: string; taskQueue: string }
}): Record<string, unknown> => {
  void options
  void defaults
  // TODO(codex): Combine start and signal payloads into the JSON envelope described in ${CLIENT_RUNTIME_DOC} §3.
  return notImplemented('Signal-with-start serialization', CLIENT_RUNTIME_DOC)
}

export const buildStartWorkflowRequest = ({
  options,
  defaults,
}: {
  options: StartWorkflowOptions
  defaults: { namespace: string; identity: string; taskQueue: string }
}): Record<string, unknown> => {
  void options
  void defaults
  // TODO(codex): Replace legacy start payload builder by delegating to this helper once implemented (see
  // ${CLIENT_RUNTIME_DOC} completion checklist).
  return notImplemented('Start workflow serialization helper', CLIENT_RUNTIME_DOC)
}
