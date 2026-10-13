#!/usr/bin/env bash
set -euo pipefail
source_nix="${1:?}"
persistent_nix="${2:?}"
registration="${3:?}"
toolchain="${4:?}"

rsync -a --ignore-existing "$source_nix/" "$persistent_nix/"
mount --bind "$persistent_nix" "$source_nix"
NIX_REMOTE=local "$toolchain/bin/nix-store" --load-db < "$registration"
install -d "$source_nix/var/nix/gcroots"
ln -sfn "$toolchain" "$source_nix/var/nix/gcroots/devbox-toolchain"
