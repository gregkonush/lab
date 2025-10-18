// TODO(codex, zig-pend-01): Implement pending handle state machine shared by client + byte array flows.
// TODO(codex, zig-pend-02): Expose structured error payloads for pending handles consumed in JS.

pub const PendingClient = opaque {};
pub const PendingByteArray = opaque {};

pub fn createClientPlaceholder() ?*PendingClient {
    return null;
}

pub fn createByteArrayPlaceholder() ?*PendingByteArray {
    return null;
}
