#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROTO_DIR="${ROOT_DIR}/proto"
TS_OUT_DIR="${ROOT_DIR}/apps/froussard/src/proto"
BIN_DIR="${ROOT_DIR}/bin"
PROTO_FILE="facteur/v1/contract.proto"
GO_PB_DIR="${ROOT_DIR}/services/facteur/internal/facteurpb"

GO_PLUGIN_VERSION="v1.33.0"
TS_PROTO_VERSION="1.176.0"

mkdir -p "${BIN_DIR}"

echo "Installing protoc-gen-go ${GO_PLUGIN_VERSION}..."
GOBIN="${BIN_DIR}" go install "google.golang.org/protobuf/cmd/protoc-gen-go@${GO_PLUGIN_VERSION}"

export PATH="${BIN_DIR}:${PATH}"

mkdir -p "${GO_PB_DIR}" "${TS_OUT_DIR}"

echo "Generating Go stubs..."
protoc \
  --proto_path="${PROTO_DIR}" \
  --go_out="${ROOT_DIR}" \
  --go_opt=module=github.com/gregkonush/lab \
  --go_opt=Mfacteur/v1/contract.proto=github.com/gregkonush/lab/services/facteur/internal/facteurpb \
  --experimental_allow_proto3_optional \
  "${PROTO_FILE}"

echo "Generating TypeScript stubs..."
pnpm dlx --package "ts-proto@${TS_PROTO_VERSION}" -- \
  protoc \
    --proto_path="${PROTO_DIR}" \
    --ts_proto_out="${TS_OUT_DIR}" \
    --ts_proto_opt=esModuleInterop=true,env=browser,useDate=true,useOptionals=messages,stringEnums=true,outputServices=none,exportCommonSymbols=false,outputClientImpl=false,outputJsonMethods=false,outputEncodeMethods=true \
    --experimental_allow_proto3_optional \
    "${PROTO_FILE}"

echo "Protobuf generation complete."
