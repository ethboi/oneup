#!/usr/bin/env bash
# Builds every contract to target/near/<name>/<name>.wasm
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")"
pnpm -C .. exec tsx scripts/build-manifest.ts begin
for c in house extra-life oneup-token ve market mock-usdc mock-oracle mock-swap mock-vault; do
  (cd "$c" && cargo near build non-reproducible-wasm --no-abi)
done

pnpm -C .. exec tsx scripts/build-manifest.ts finish
