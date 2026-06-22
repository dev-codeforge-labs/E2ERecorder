#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$ROOT/dist"
XPI="$DIST/e2e-recorder-v2.xpi"

echo "[E2E Recorder] Building XPI..."

mkdir -p "$DIST"
rm -f "$XPI"

# Files and directories to include in the XPI
INCLUDE=(
  manifest.json
  background.js
  content.js
  popup.html
  popup.css
  popup.js
  README.md
  modules
  icons
)

cd "$ROOT"

# zip is the standard tool for XPI packaging
if command -v zip &>/dev/null; then
  zip -r -9 "$XPI" "${INCLUDE[@]}"
elif command -v python3 &>/dev/null; then
  python3 - "$XPI" "${INCLUDE[@]}" <<'PYEOF'
import sys, zipfile, os, pathlib

xpi_path = sys.argv[1]
items    = sys.argv[2:]

with zipfile.ZipFile(xpi_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for item in items:
        p = pathlib.Path(item)
        if p.is_file():
            zf.write(p, p)
        elif p.is_dir():
            for f in sorted(p.rglob('*')):
                if f.is_file():
                    zf.write(f, f)

print(f'[E2E Recorder] XPI ready: {xpi_path}')
PYEOF
else
  echo "ERROR: Neither 'zip' nor 'python3' found. Install one of them and retry."
  exit 1
fi

echo "[E2E Recorder] XPI ready: $XPI"
