const std = @import("std");
const errors = @import("errors.zig");
const runtime = @import("runtime.zig");
const client = @import("client.zig");
const byte_array = @import("byte_array.zig");

fn sliceFrom(ptr: ?[*]const u8, len: u64) []const u8 {
    if (ptr == null or len == 0) {
        return &[_]u8{};
    }

    const size: usize = @intCast(len);
    return ptr.?[0..size];
}

fn markNotImplemented(feature: []const u8) void {
    errors.setLastErrorFmt("temporal-bun-bridge-zig: {s} is not implemented yet", .{feature});
}

pub export fn temporal_bun_runtime_new(payload_ptr: ?[*]const u8, len: u64) ?*runtime.RuntimeHandle {
    const payload = sliceFrom(payload_ptr, len);
    return runtime.create(payload);
}

pub export fn temporal_bun_runtime_free(handle: ?*runtime.RuntimeHandle) void {
    runtime.destroy(handle);
}

pub export fn temporal_bun_error_message(len_ptr: ?*u64) ?[*]u8 {
    return errors.takeForFfi(len_ptr);
}

pub export fn temporal_bun_error_free(ptr: ?[*]u8, len: u64) void {
    errors.freeFfiBuffer(ptr, len);
}

pub export fn temporal_bun_client_connect_async(
    runtime_ptr: ?*runtime.RuntimeHandle,
    payload_ptr: ?[*]const u8,
    len: u64,
) ?*anyopaque {
    const payload = sliceFrom(payload_ptr, len);
    markNotImplemented("client connect");
    _ = runtime_ptr;
    _ = payload;
    return null;
}

pub export fn temporal_bun_client_free(handle: ?*client.ClientHandle) void {
    client.destroy(handle);
}

pub export fn temporal_bun_client_describe_namespace_async(
    client_ptr: ?*client.ClientHandle,
    payload_ptr: ?[*]const u8,
    len: u64,
) ?*anyopaque {
    const payload = sliceFrom(payload_ptr, len);
    _ = client_ptr;
    _ = payload;
    markNotImplemented("describe namespace");
    return null;
}

pub export fn temporal_bun_client_update_headers(
    client_ptr: ?*client.ClientHandle,
    payload_ptr: ?[*]const u8,
    len: u64,
) i32 {
    const payload = sliceFrom(payload_ptr, len);
    _ = client_ptr;
    _ = payload;
    markNotImplemented("update client headers");
    return -1;
}

pub export fn temporal_bun_pending_client_poll(_handle: ?*anyopaque) i32 {
    markNotImplemented("pending client poll");
    _ = _handle;
    return -1;
}

pub export fn temporal_bun_pending_client_consume(_handle: ?*anyopaque) ?*client.ClientHandle {
    markNotImplemented("pending client consume");
    _ = _handle;
    return null;
}

pub export fn temporal_bun_pending_client_free(_handle: ?*anyopaque) void {
    _ = _handle;
}

pub export fn temporal_bun_pending_byte_array_poll(_handle: ?*anyopaque) i32 {
    markNotImplemented("pending byte array poll");
    _ = _handle;
    return -1;
}

pub export fn temporal_bun_pending_byte_array_consume(_handle: ?*anyopaque) ?*byte_array.ByteArray {
    markNotImplemented("pending byte array consume");
    _ = _handle;
    return null;
}

pub export fn temporal_bun_pending_byte_array_free(_handle: ?*anyopaque) void {
    _ = _handle;
}

pub export fn temporal_bun_byte_array_free(handle: ?*byte_array.ByteArray) void {
    byte_array.free(handle);
}

pub export fn temporal_bun_client_start_workflow(
    client_ptr: ?*client.ClientHandle,
    payload_ptr: ?[*]const u8,
    len: u64,
) ?*byte_array.ByteArray {
    const payload = sliceFrom(payload_ptr, len);
    _ = client_ptr;
    _ = payload;
    markNotImplemented("start workflow");
    return null;
}

pub export fn temporal_bun_client_terminate_workflow(
    client_ptr: ?*client.ClientHandle,
    payload_ptr: ?[*]const u8,
    len: u64,
) i32 {
    const payload = sliceFrom(payload_ptr, len);
    return client.terminateWorkflow(client_ptr, payload);
}

pub export fn temporal_bun_client_signal_with_start(
    client_ptr: ?*client.ClientHandle,
    payload_ptr: ?[*]const u8,
    len: u64,
) ?*byte_array.ByteArray {
    const payload = sliceFrom(payload_ptr, len);
    return client.signalWithStart(client_ptr, payload);
}

pub export fn temporal_bun_client_query_workflow(
    client_ptr: ?*client.ClientHandle,
    payload_ptr: ?[*]const u8,
    len: u64,
) ?*anyopaque {
    const payload = sliceFrom(payload_ptr, len);
    return client.queryWorkflow(client_ptr, payload);
}
