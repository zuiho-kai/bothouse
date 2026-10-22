#!/bin/sh
# Apply the DSH steer patch to an installed @deepseek-ai/dsh-acp.
# Usage: sh apply.sh <DSH run dir containing node_modules | dsh-acp package dir>
# Idempotent: an already patched package is left alone. Run again after every
# npm install / DSH upgrade (npm overwrites node_modules).
set -eu

# The only dsh-acp version this patch was written and tested against
# (live jingyu-dsh / minimax-dsh instances, 2026-10-21..23).
EXPECTED_VERSION="0.2.1-rc.2"

here=$(cd "$(dirname "$0")" && pwd)
target=${1:-.}
if [ -f "$target/node_modules/@deepseek-ai/dsh-acp/package.json" ]; then
	pkg="$target/node_modules/@deepseek-ai/dsh-acp"
elif [ -f "$target/package.json" ] && grep -q '"name": "@deepseek-ai/dsh-acp"' "$target/package.json"; then
	pkg="$target"
else
	echo "dsh-acp-steer: @deepseek-ai/dsh-acp not found under $target" >&2
	exit 1
fi

version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$pkg/package.json")
if [ "$version" != "$EXPECTED_VERSION" ]; then
	echo "dsh-acp-steer: dsh-acp $version is not $EXPECTED_VERSION; patch not applied (port and retest it first)" >&2
	exit 1
fi

if grep -q '_meta: { "dsh/steer": true }' "$pkg/lib/index.js"; then
	echo "dsh-acp-steer: already patched ($pkg)"
	exit 0
fi

patch -d "$pkg" -p1 -b --dry-run < "$here/dsh-acp-steer.patch" >/dev/null
patch -d "$pkg" -p1 -b < "$here/dsh-acp-steer.patch"
echo "dsh-acp-steer: patched $pkg (original kept as lib/index.js.orig); restart the DSH ACP process"
