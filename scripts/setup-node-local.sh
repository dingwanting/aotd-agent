#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${1:-v24.18.0}"
OS="darwin"
ARCH="$(uname -m)"

if [[ "$ARCH" == "arm64" ]]; then
  NODE_ARCH="arm64"
else
  NODE_ARCH="x64"
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_DIR="$ROOT_DIR/.local-node"
TARBALL="node-${NODE_VERSION}-${OS}-${NODE_ARCH}.tar.gz"
URL="https://nodejs.org/dist/${NODE_VERSION}/${TARBALL}"

mkdir -p "$LOCAL_DIR"
cd "$LOCAL_DIR"

if [[ ! -d "node-${NODE_VERSION}-${OS}-${NODE_ARCH}" ]]; then
  curl -fL --retry 5 --retry-all-errors --retry-delay 3 "$URL" -o "$TARBALL"
  tar -xzf "$TARBALL"
fi

echo "Node installed at:"
echo "$LOCAL_DIR/node-${NODE_VERSION}-${OS}-${NODE_ARCH}/bin"
echo
echo "Use it with:"
echo "export PATH=\"$LOCAL_DIR/node-${NODE_VERSION}-${OS}-${NODE_ARCH}/bin:\$PATH\""
