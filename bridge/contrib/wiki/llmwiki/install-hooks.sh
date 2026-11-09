#!/bin/sh
set -eu
root=${1:?usage: bin/install-hooks.sh <wiki root>}
hooks=$(CDPATH= cd -- "$(dirname -- "$0")/hooks" && pwd)
test -x "$hooks/pre-commit" || { echo "no executable $hooks/pre-commit" >&2; exit 1; }
top=$(git -C "$root" rev-parse --show-toplevel)
old=$(git -C "$top" config --get core.hooksPath || true)
if [ -n "$old" ] && [ "$old" != "$hooks" ]; then
    echo "$top: core.hooksPath was $old, now $hooks" >&2
fi
git -C "$top" config core.hooksPath "$hooks"
echo "$top: pre-commit -> $hooks/pre-commit"
