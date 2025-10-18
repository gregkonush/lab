const std = @import("std");
const errors = @import("errors.zig");
const runtime = @import("runtime.zig");
const byte_array = @import("byte_array.zig");

pub const ClientHandle = struct {
    id: u64,
    runtime: ?*runtime.RuntimeHandle,
    config: []u8,
};

pub fn connectAsync(_runtime: ?*runtime.RuntimeHandle, config_json: []const u8) ?*ClientHandle {
    _ = config_json;
    _ = _runtime;

    // TODO(codex, zig-cl-01): Spawn async connect using Temporal core client (`temporal_sdk_core_client_connect`).
    errors.setLastError("temporal-bun-bridge-zig: client connect is not implemented yet (see docs/zig-bridge-migration-plan.md)");
    return null;
}

pub fn destroy(handle: ?*ClientHandle) void {
    if (handle == null) {
        return;
    }

    var allocator = std.heap.c_allocator;
    const client = handle.?;

    if (client.config.len > 0) {
        allocator.free(client.config);
    }

    allocator.destroy(client);
}

pub fn describeNamespaceAsync(_client: ?*ClientHandle, _payload: []const u8) ?*anyopaque {
    // TODO(codex, zig-cl-02): Bridge namespace describes via Temporal core pending byte arrays.
    _ = _client;
    _ = _payload;
    errors.setLastError("temporal-bun-bridge-zig: describeNamespace is not implemented yet (pending Rust core wiring)");
    return null;
}

pub fn startWorkflow(_client: ?*ClientHandle, _payload: []const u8) ?*byte_array.ByteArray {
    // TODO(codex, zig-wf-01): Marshal workflow start request into Temporal core and return run handles.
    _ = _client;
    _ = _payload;
    errors.setLastError("temporal-bun-bridge-zig: startWorkflow is not wired to Temporal core yet");
    return null;
}

pub fn signalWithStart(_client: ?*ClientHandle, _payload: []const u8) ?*byte_array.ByteArray {
    // TODO(codex, zig-wf-02): Implement signalWithStart once start + signal bridges exist.
    _ = _client;
    _ = _payload;
    errors.setLastError("temporal-bun-bridge-zig: signalWithStart is not implemented yet");
    return null;
}

pub fn terminateWorkflow(_client: ?*ClientHandle, _payload: []const u8) i32 {
    // TODO(codex, zig-wf-03): Wire termination RPC to Temporal core client.
    _ = _client;
    _ = _payload;
    errors.setLastError("temporal-bun-bridge-zig: terminateWorkflow is not implemented yet");
    return -1;
}

pub fn updateHeaders(_client: ?*ClientHandle, _payload: []const u8) i32 {
    // TODO(codex, zig-cl-03): Push metadata updates to Temporal core client.
    _ = _client;
    _ = _payload;
    errors.setLastError("temporal-bun-bridge-zig: updateHeaders is not implemented yet");
    return -1;
}

pub fn queryWorkflow(_client: ?*ClientHandle, _payload: []const u8) ?*anyopaque {
    // TODO(codex, zig-wf-04): Implement workflow query bridge using pending byte arrays.
    _ = _client;
    _ = _payload;
    errors.setLastError("temporal-bun-bridge-zig: queryWorkflow is not implemented yet");
    return null;
}
