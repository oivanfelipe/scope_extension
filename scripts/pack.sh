#!/usr/bin/env bash
# Gera dist/scope-extension-vX.Y.Z.zip só com os arquivos que a extensão precisa.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/scope-extension-v${VERSION}.zip"
mkdir -p dist && rm -f "$OUT"
zip -r -q "$OUT" manifest.json background.js assets lib sidepanel -x '*.DS_Store'
echo "Gerado: $OUT"
