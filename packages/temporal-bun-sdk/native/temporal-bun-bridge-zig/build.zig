const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const lib_module = b.createModule(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });

    const lib = b.addLibrary(.{
        .name = "temporal_bun_bridge_zig",
        .root_module = lib_module,
        .linkage = .dynamic,
    });

    // TODO(codex, zig-pack-01): Link Temporal Rust static libraries emitted by cargo+cbindgen.

    const install = b.addInstallArtifact(lib, .{});
    b.getInstallStep().dependOn(&install.step);

    const test_module = b.createModule(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });

    const unit_tests = b.addTest(.{
        .root_module = test_module,
    });

    const test_step = b.step("test", "Run Zig bridge tests (stub)");
    test_step.dependOn(&b.addRunArtifact(unit_tests).step);
}
