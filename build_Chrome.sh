#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
NAME="e2e-recorder-v2-chrome.zip"
OUT="$DIST/$NAME"

mkdir -p "$DIST"

echo "[E2E Recorder] Building Chrome ZIP..."

# Files to pack (manifest_chrome.json is renamed to manifest.json inside the ZIP)
ITEMS="background.js content.js popup.html popup.css popup.js modules icons"
if [ -f "$ROOT/README.md" ]; then ITEMS="$ITEMS README.md"; fi

TMP="$DIST/e2e-recorder-chrome.tmp.zip"
rm -f "$TMP"

if command -v zip &>/dev/null; then
    # Use system zip
    cd "$ROOT"
    # Pack manifest_chrome.json as manifest.json
    cp manifest_chrome.json manifest_chrome_as_manifest.json
    zip -r "$TMP" manifest_chrome_as_manifest.json $ITEMS
    # Rename the entry inside the zip
    cd "$DIST"
    if command -v python3 &>/dev/null; then
        python3 - "$TMP" <<'PYEOF'
import zipfile, shutil, os, sys
src = sys.argv[1]
tmp = src + ".repack.zip"
with zipfile.ZipFile(src, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        name = item.filename
        if name == "manifest_chrome_as_manifest.json":
            name = "manifest.json"
        data = zin.read(item.filename)
        zout.writestr(name, data)
os.replace(tmp, src)
PYEOF
    fi
    cd "$ROOT"
    rm -f manifest_chrome_as_manifest.json
else
    # Fallback: Python zip
    python3 - "$ROOT" "$TMP" <<'PYEOF'
import zipfile, os, sys

root = sys.argv[1]
out  = sys.argv[2]
items = ["background.js","content.js","popup.html","popup.css","popup.js","modules","icons"]
if os.path.exists(os.path.join(root, "README.md")):
    items.append("README.md")

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    # manifest_chrome.json → manifest.json
    zf.write(os.path.join(root, "manifest_chrome.json"), "manifest.json")
    for item in items:
        src = os.path.join(root, item)
        if os.path.isfile(src):
            zf.write(src, item)
        elif os.path.isdir(src):
            for dirpath, _, files in os.walk(src):
                for f in files:
                    full = os.path.join(dirpath, f)
                    arcname = os.path.relpath(full, root).replace(os.sep, "/")
                    zf.write(full, arcname)
PYEOF
fi

mv "$TMP" "$OUT"
SIZE=$(du -k "$OUT" | cut -f1)
echo "[E2E Recorder] Chrome ZIP ready: $OUT  (${SIZE} KB)"
echo ""
echo "To load in Chrome:"
echo "  1. Unzip $OUT to a folder (e.g. dist/chrome/)"
echo "  2. Open chrome://extensions"
echo "  3. Enable Developer mode"
echo "  4. Click 'Load unpacked' and select that folder"
echo ""
echo "  OR upload the ZIP to the Chrome Web Store."
