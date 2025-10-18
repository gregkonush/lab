## Zig Bridge Scaffold Checklist

The items below slice the Zig bridge effort into PR-sized TODOs. Every ID maps back to an in-line
`TODO(codex, …)` marker so contributors can grab a task without re-planning. Reference
`zig-bridge-migration-plan.md` for macro phases.

### Runtime Bootstrap

| ID | Description | Entry point | Acceptance |
|----|-------------|-------------|------------|
| zig-core-01 | Generate Temporal core headers via `cbindgen` and plumb them through `src/core.zig`. | `src/core.zig` | Headers vendored + imported; stubs removed. |
| zig-rt-01 | Replace runtime stub with calls to `temporal_sdk_core_runtime_new`. | `src/runtime.zig` | Runtime handle stores opaque pointer; error propagation verified. |
| zig-rt-02 | Release runtime through the C-ABI destructor and clear allocations. | `src/runtime.zig` | Drop routine calls C core + passes tests. |

### Client Lifecycle

| ID | Description | Entry point | Acceptance |
|----|-------------|-------------|------------|
| zig-cl-01 | Implement async client connect backed by Temporal core + pending handles. | `src/client.zig`, `src/pending.zig` | `connectAsync` returns pending handle consumed by TS tests. |
| zig-cl-02 | Wire namespace describe RPC to Temporal core and return byte arrays. | `src/client.zig` | Fixture test decodes namespace info. |
| zig-cl-03 | Pass header update requests through to Temporal core metadata APIs. | `src/client.zig` | Unit test confirms headers applied. |

### Workflow RPCs

| ID | Description | Entry point | Acceptance |
|----|-------------|-------------|------------|
| zig-wf-01 | Marshal workflow start payloads and return run handles. | `src/client.zig` | Start smoke test passes via Zig bridge. |
| zig-wf-02 | Implement signal-with-start using shared marshalling path. | `src/client.zig` | Integration test covers signal and start success. |
| zig-wf-03 | Add terminate workflow RPC bridging. | `src/client.zig` | Temporal terminate scenario passes via Zig bridge. |
| zig-wf-04 | Implement workflow query RPC using pending byte arrays. | `src/client.zig` | Query integration test succeeds. |

### Byte Array & Pending Handles

| ID | Description | Entry point | Acceptance |
|----|-------------|-------------|------------|
| zig-buf-01 | Swap stub allocator for zero-copy handling of Temporal-owned buffers. | `src/byte_array.zig` | Roundtrip tests prove no leaks and zero-copy when possible. |
| zig-buf-02 | Add guardrails + telemetry counters for buffer allocations. | `src/byte_array.zig` | Metrics surfaced to TS layer; unit tests cover failure cases. |
| zig-pend-01 | Implement reusable pending handle state machine for clients + byte arrays. | `src/pending.zig` | Concurrent stress test passes; TS polling logic unchanged. |
| zig-pend-02 | Surface structured errors from pending handles to TypeScript. | `src/pending.zig` | Errors deliver JSON payload + status code. |

### Tooling & Distribution

| ID | Description | Entry point | Acceptance |
|----|-------------|-------------|------------|
| zig-pack-01 | Link Zig build against Temporal static libraries emitted by Cargo. | `build.zig` | `build:native:zig` links successfully on macOS/Linux. |
| zig-pack-02 | Ship Zig artifacts in npm package (`zig-out/lib` per target). | `package.json`, publish pipeline | Pack command includes Zig binaries with fallback. |
| zig-pack-03 | Document Zig toolchain requirements + installation flow. | `README.md`, docs | README section updated, CI job references version. |
| zig-pack-04 | CI executes `zig build test` in addition to existing Rust bridge smoke tests. | CI configs | Pipeline green with dual bridge verification (see `.github/workflows/temporal-bun-sdk-zig.yml`). |

Grab a single ID, replace the matching TODO in code, and keep scope bounded so each merge delivers
an incremental capability.
