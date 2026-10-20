#!/usr/bin/env bash
# Builds every contract to target/near/<name>/<name>.wasm
set -euo pipefail
cd "$(dirname "$0")"
for c in house extra-life mock-usdc mock-oracle; do
  (cd "$c" && cargo near build non-reproducible-wasm --no-abi)
done
