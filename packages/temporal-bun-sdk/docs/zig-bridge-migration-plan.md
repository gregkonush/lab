# Temporal Bun SDK — Zig Bridge Migration Plan

**Status:** Draft for implementation sign-off (18 Oct 2025)  
**Owner:** Platform Runtime (Temporal Bun)  
**Related Issue:** #1458 — Native Bun support with Zig

---

## 1. Problem Statement

The current `temporal-bun-bridge` native layer is implemented in Rust and compiled with Cargo. While it delivers the Bun ↔ Temporal FFI surface defined in `docs/ffi-surface.md`, the Rust toolchain introduces material friction:

- ❌ Bun projects must install Rust + Cargo just to consume the SDK.
- ❌ Native builds are slow (multi-minute cold builds) and increase CI image weight.
- ❌ Shipping prebuilt artifacts requires cross-compiling via Cargo + `cross`, which complicates release automation.

To provide first-class Bun developer ergonomics we will reimplement the native bridge in Zig and align with Bun’s toolchain expectations.

---

## 2. Goals & Non-Goals

| Goals | Non-Goals |
|-------|-----------|
| Provide a Zig-built shared library exposing the `temporal_bun_*` symbols consumed by `src/internal/core-bridge/native.ts`. | Rewriting Temporal Core itself in Zig. We will continue to embed the upstream runtime via its C-ABI surface. |
| Match the existing successful client paths: runtime bootstrap, async client connect, namespace describe, workflow start. | Full worker runtime parity on day one. Worker APIs will move in a later phase. |
| Remove the direct dependency on `cargo` for consumers; only Zig (>=0.15.x) is required to build from source. | Dropping the Rust toolchain from **our** CI machines immediately. Until Zig parity is complete we keep Rust builds available for fallback. |
| Ship phased plan, validation strategy, owners, and rollout guardrails. | Changing Temporal server deployment. |

---

## 3. Current Surface Inventory (Oct 2025 Snapshot)

| Area | Symbol | Notes |
|------|--------|-------|
| Runtime | `temporal_bun_runtime_new`, `temporal_bun_runtime_free` | Used by `native.createRuntime` in TypeScript. Options payload currently ignored. |
| Client Async | `temporal_bun_client_connect_async`, pending poll/consume/free trio | Produces a `PendingClientHandle` polled from JS event loop. |
| Client RPCs | `temporal_bun_client_describe_namespace_async`, `temporal_bun_client_start_workflow` | Describe returns pending byte array, Start returns immediate byte array. |
| Error Surface | `temporal_bun_error_message`, `temporal_bun_error_free` | Shared error buffer read from JS. |
| Future Work | Telemetry hooks, metadata updates, signal/query/terminate/cancel APIs | Documented as TODOs in TypeScript and the Rust bridge; parity required in Zig plan phases. |

Supporting modules:

- `native/pending.rs` spawns Tokio futures in background threads and exposes poll/consume semantics.
- `native/byte_array.rs` allocates byte buffers with ownership transfer semantics expected by Bun.
- Build target emits `libtemporal_bun_bridge.{so|dylib|dll}` under `target/{debug,release}`.

---

## 4. Proposed Architecture (Zig)

### 4.1 Layering Overview

```
Bun (bun:ffi) ──▶ Zig Bridge (libtemporal_bun_bridge.zig)
                   │
                   ├─ Temporal Core Runtime (Rust) via C-ABI shim
                   ├─ Temporal gRPC stubs generated from proto → C bindings
                   └─ Async executor + channel implementation in Zig
```

1. **Zig Shared Library**  
   - Expose the same `temporal_bun_*` function signatures.  
   - Encode/decode JSON payloads using Zig stdlib (`std.json` with arena allocators).  
   - Maintain error buffer as `[*]u8` with length output mirroring current contract.

2. **Temporal Core Embedding**  
   - Build `temporal-sdk-core` and client crates as static libraries (`cargo build --release --target x86_64-unknown-linux-gnu --features c-api`).  
   - Generate C headers with `cbindgen` exposing `temporal_sdk_core_*` functions.  
   - Import headers into Zig via `@cImport` and wrap them with Zig-friendly safety layers.

3. **Async Pending Handles**  
   - Replace Tokio background threads with Zig `std.Thread.spawn` + condition variables, or leverage Zig’s event loop (`async`/`await`).  
   - Expose a `PendingHandle` struct storing state + mutex-protected union (`pending | ok | err`).  
   - Poll from Bun by checking atomic state; consume transfers ownership to Zig-managed heap slice.

4. **Byte Array Transport**  
   - Represent as struct `{ ptr: [*]u8, len: usize, cap: usize }` to match existing layout.  
   - Provide constructor helpers to zero-copy when safe or allocate copy when required.

5. **Telemetry & Logging Hooks (Forward-Looking)**  
   - Keep slots for telemetry + logger callbacks; Zig will forward to Bun via function pointers (`extern struct`).  
   - Ensure `configureTelemetry` becomes a no-op until the underlying C-ABI exposes toggles.

---

## 5. Implementation Phases

| Phase | Scope | Deliverables | Exit Criteria |
|-------|-------|--------------|---------------|
| 0 — Scaffolding | Add `native/temporal-bun-bridge-zig` with `build.zig`, hook into `pnpm build:native`. Generate C headers from Rust core (temporary). | Passing `zig build install` producing `.so/.dylib/.dll`, TypeScript loads via `bun:ffi` override behind feature flag. | `bun run packages/temporal-bun-sdk/scripts/smoke-client.ts` connects & describes namespace using Zig library gated by `TEMPORAL_BUN_SDK_USE_ZIG=1`. |
| 1 — Client Parity | Reimplement runtime + client connect + describe + start workflow. Maintain async pending handles. | Toggle default to Zig bridge on CI when env flag enabled. Update TS to fall back to Rust when Zig load fails. | `bun test` suite passes with Zig shared lib; docs updated. |
| 2 — Client Enhancements | Implement signal/query/terminate/cancel/signalWithStart + metadata updates. Add telemetry + logger support. | All TODOs in `src/internal/core-bridge/native.ts` removed or delegated to Zig. | Temporal integration tests (docker compose) green under Zig path. |
| 3 — Worker Runtime | Port worker creation, poll/complete, activity heartbeat. Mirror existing FFI blueprint. | `temporal-bun-worker` binary runs end-to-end solely on Zig bridge. | Example app runs against Temporal server without Rust artifacts. |
| 4 — Cleanup & Release | Remove Rust bridge, deprecate Cargo build scripts, publish prebuilt binaries (GitHub releases). | No Rust toolchain needed for consumers; README + scripts updated. |

---

## 6. Build & Tooling Updates

1. **Zig Toolchain Version** — Standardize on Zig 0.15.1 (matches `services/galette`). Document installation in README.  
2. **Package Scripts** — Replace `cargo build` script with:
   ```json
   "build:native": "zig build -Doptimize=ReleaseFast --build-file native/temporal-bun-bridge-zig/build.zig"
   ```
   Provide `build:native:debug` equivalent for development.
3. **CI Images** — Extend Docker images with Zig; drop Rust once Phase 4 completes.  
4. **Prebuilt Artifacts** — Use `zig build install` to stage artifacts under `native/artifacts/<platform>/`.  
5. **NPM Packaging** — Update publish step to copy Zig binaries into `dist/native/<platform>/`.

---

## 7. Validation Strategy

- **Unit Tests (Zig)** — `zig build test` covering JSON parsing, pending handle state machine, error propagation.  
- **Bun Tests** — Extend `packages/temporal-bun-sdk/tests` to run against both bridges (feature flag).  
- **Integration** — Docker Compose Temporal stack verifying workflow start/signal/query across Linux/macOS.  
- **Performance Benchmarks** — Compare latency + CPU usage vs Rust bridge (target within ±5%).  
- **Cross-Platform Smoke** — x64 Linux, macOS (x64 + arm64 via Rosetta), Windows (MSVC). Use GitHub Actions matrix with Zig toolchain.

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Zig async runtime divergence vs Tokio semantics. | Pending handles may deadlock or starve. | Use dedicated worker threads managed in Zig; add stress tests with artificial latency. |
| Linking Rust static libs into Zig. | Build failures, symbol mismatch. | Introduce C shim crate exporting stable ABI; pin commit + verify with `zig build check`. |
| Release artifacts size/regression. | Consumer install friction. | Strip symbols (`zig build -Dstrip`) and compress binaries post-build. |
| Windows support parity. | Bun users on Windows blocked. | Validate MSVC toolchain early; add GitHub Actions job gating merges. |
| Telemetry/logging fallbacks. | Feature parity gap. | Keep Rust bridge available behind flag until telemetry features ship. Document limitations. |

---

## 9. Open Questions

1. Do we maintain dual-bridge mode long term (Rust fallback) or enforce Zig-only after Phase 4?  
2. Should we upstream Zig bindings to Temporal to reduce maintenance burden?  
3. What is the expected minimum Zig version for Bun consumers (align with Bun 1.1.x release cadence)?  
4. How will we distribute Apple arm64 binaries safely (notarization requirements)?

---

## 10. Next Steps

1. Socialize this plan with Temporal Runtime stakeholders for approval.  
2. Schedule Phase 0 spike (time-boxed) to validate Zig ↔ Rust static link viability.  
3. Once approved, convert phases into tracked GitHub issues / project items with owners & timelines.

