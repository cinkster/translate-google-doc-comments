#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/extension/manifest.json" | head -n 1)
DIST="$ROOT/dist"
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/docs-comment-translator.XXXXXX")

cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT INT TERM

if [ -z "$VERSION" ]; then
  printf '%s\n' "Could not read the extension version." >&2
  exit 1
fi

rm -rf "$DIST"
mkdir -p "$DIST" "$STAGE/chrome" "$STAGE/test-kit/tests" "$STAGE/test-kit/scripts"

cp -R "$ROOT/extension/." "$STAGE/chrome/"
find "$STAGE/chrome" -name '.DS_Store' -delete
(
  cd "$STAGE/chrome"
  /usr/bin/zip -q -r "$DIST/docs-comment-translator-chrome-$VERSION.zip" .
)

cp -R "$ROOT/extension" "$STAGE/test-kit/extension"
cp "$ROOT/tests/fixture.html" "$STAGE/test-kit/tests/fixture.html"
cp "$ROOT/tests/google-docs-replica.css" "$STAGE/test-kit/tests/google-docs-replica.css"
cp "$ROOT/tests/google-docs-replica.js" "$STAGE/test-kit/tests/google-docs-replica.js"
cp "$ROOT/scripts/package-safari.sh" "$STAGE/test-kit/scripts/package-safari.sh"
cp "$ROOT/DISTRIBUTION.md" "$STAGE/test-kit/TRY-ME.md"
find "$STAGE/test-kit" -name '.DS_Store' -delete
(
  cd "$STAGE/test-kit"
  /usr/bin/zip -q -r "$DIST/docs-comment-translator-test-kit-$VERSION.zip" .
)

(
  cd "$DIST"
  shasum -a 256 ./*.zip > SHA256SUMS.txt
)

printf 'Created bundles in %s\n' "$DIST"
