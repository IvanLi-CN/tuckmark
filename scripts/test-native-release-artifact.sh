#!/usr/bin/env bash
set -euo pipefail

archive=${1:?archive path required}
target=${2:?target required}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
tar -xzf "$archive" -C "$tmp"
root=$(find "$tmp" -maxdepth 1 -type d -name 'tuckmark-*' -print -quit)
test -x "$root/tuckmark" && test -x "$root/tuckmark-devd"
isolated_path="$tmp/empty-bin"
mkdir "$isolated_path"
test "$(PATH="$isolated_path" command -v node || true)" = ""
test "$(PATH="$isolated_path" command -v bun || true)" = ""
test "$(PATH="$isolated_path" command -v npm || true)" = ""
"$root/tuckmark" --help >/dev/null
"$root/tuckmark-devd" --help >/dev/null
if command -v otool >/dev/null 2>&1; then
  ! otool -L "$root/tuckmark" "$root/tuckmark-devd" | grep -Eiq '(node|bun|npm|libnode)'
fi
test -n "$target"
