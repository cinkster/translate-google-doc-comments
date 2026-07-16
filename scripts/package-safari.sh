#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CONVERTER=$(xcrun --find safari-web-extension-converter 2>/dev/null || true)

if [ -z "$CONVERTER" ]; then
  printf '%s\n' "Safari packaging requires full Xcode and safari-web-extension-converter." >&2
  printf '%s\n' "Install Xcode, then select it with: sudo xcode-select -s /Applications/Xcode.app" >&2
  exit 1
fi

mkdir -p "$ROOT/Safari"
"$CONVERTER" "$ROOT/extension" \
  --project-location "$ROOT/Safari" \
  --app-name "Docs Comment Translator" \
  --bundle-identifier "com.christianinkster.docscommenttranslator" \
  --macos-only \
  --copy-resources \
  --no-open

printf '%s\n' "Safari project created under $ROOT/Safari"

