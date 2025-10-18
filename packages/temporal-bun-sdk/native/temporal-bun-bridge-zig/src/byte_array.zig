const std = @import("std");
const errors = @import("errors.zig");

// TODO(codex, zig-buf-01): Support zero-copy interop with Temporal core-owned buffers.
// TODO(codex, zig-buf-02): Emit allocation telemetry and guardrails for Bun-facing buffers.

pub const ByteArray = extern struct {
    data_ptr: ?[*]u8,
    len: usize,
    cap: usize,
};

pub fn allocate(bytes: []const u8) ?*ByteArray {
    var allocator = std.heap.c_allocator;

    const copy = allocator.alloc(u8, bytes.len) catch |err| {
        errors.setLastErrorFmt("temporal-bun-bridge-zig: failed to allocate byte array: {}", .{err});
        return null;
    };
    @memcpy(copy, bytes);

    const container = allocator.create(ByteArray) catch |err| {
        allocator.free(copy);
        errors.setLastErrorFmt("temporal-bun-bridge-zig: failed to allocate byte array container: {}", .{err});
        return null;
    };

    container.* = .{
        .data_ptr = copy.ptr,
        .len = bytes.len,
        .cap = bytes.len,
    };

    return container;
}

pub fn free(array: ?*ByteArray) void {
    if (array == null) {
        return;
    }

    var allocator = std.heap.c_allocator;
    const handle = array.?;

    if (handle.data_ptr) |ptr| {
        allocator.free(ptr[0..handle.len]);
    }

    allocator.destroy(handle);
}
