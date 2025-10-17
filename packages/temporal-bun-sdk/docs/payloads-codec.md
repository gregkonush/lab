# Payloads Codec & Data Conversion Guide

**Purpose:** Define how the Bun SDK encodes/decodes Temporal payloads without relying on upstream Node packages.

---

## 1. Requirements

- Support Temporal payload metadata (encoding, message type, encoding-envelope).
- Provide JSON + binary (protobuf) codecs with extensibility for custom converters.
- Expose API similar to upstream `DataConverter` (`toPayloads`, `fromPayloads`).
- Handle failure serialization (stack traces, application-specific data).

---

## 2. Module Layout

```
src/common/payloads/
  index.ts              // public exports
  codec.ts              // base codec interface + registry
  json-codec.ts         // default JSON codec
  binary-codec.ts       // optional binary codec (uses protobuf definitions)
  failure.ts            // convert errors to payloads and back
```

---

## 3. Codec Interface

```ts
export interface PayloadCodec {
  encoding: string               // e.g., 'json/plain', 'binary/protobuf'
  toPayload(value: unknown): Promise<Payload>
  fromPayload(payload: Payload): Promise<unknown>
}

export interface DataConverter {
  toPayloads(values: unknown[]): Promise<Payloads>
  fromPayloads<T = unknown>(payloads: Payloads, target?: TypeHint<T>): Promise<T[]>
  toFailure(error: unknown): Promise<Failure>
  fromFailure(failure: Failure): Promise<unknown>
}
```

`Payload` mirrors Temporal proto structure:

```ts
interface Payload {
  metadata: Record<string, Uint8Array>
  data: Uint8Array
}
```

---

## 4. Default Behavior

- `json/plain` codec serializes using `JSON.stringify`, stores encoding + content type.
- `binary/protobuf` relies on vendored `@temporalio/proto` TypeScript definitions to encode payloads (optional initial implementation).
- `DataConverter` composes an array of codecs: try each until one returns payload.
- Allow user-supplied codecs via options on `createTemporalClient` / `createWorker`.

---

## 5. Failure Handling

- On `toFailure`, include:
  - `message`
  - `stack` (string)
  - optional `applicationFailureType`
  - `nonRetryable` flag
- For `fromFailure`, reconstruct Error subclass (default `ApplicationFailure`).
- Ensure heartbeats and activity completions propagate failure payloads correctly.

---

## 6. Testing

- Codec unit tests: round-trip JS primitives, buffers, complex objects.
- Failure serialization tests: error with cause chain, non-retryable flag.
- Integration: workflow returning JSON, signal passing binary, activity throwing error.

---

## 7. Migration Considerations

- Document that initial release supports JSON only (if binary deferred).
- Provide extension hook so adopters can supply their own codecs without forking.

Maintain this document whenever payload handling evolves.
