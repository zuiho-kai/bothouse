#!/usr/bin/env bash
# Run from any directory. All Go tests use tests/testutil's isolated HOME/CLI.
# --negative-control REF overlays only pre-fix qq.go, leaving final tests intact.
# --binary PATH additionally runs an isolated copy of the actual built CLI.
set -euo pipefail
# Matches CI: Python helpers must not create __pycache__ in Go embed inputs.
export PYTHONDONTWRITEBYTECODE=1
bridge=$(cd "$(dirname "$0")/../.." && pwd)
negative=""
binary=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --negative-control) negative=${2:?missing git ref}; shift 2 ;;
    --binary) binary=${2:?missing built binary}; shift 2 ;;
    *) echo "usage: $0 [--negative-control REF] [--binary /absolute/path/to/bothouse]" >&2; exit 2 ;;
  esac
done
cd "$bridge"
evidence=$(mktemp -d "${TMPDIR:-/tmp}/qq-resilience.XXXXXX")
echo "evidence: $evidence"
cases='^(TestQQACP|TestQQACPMediaOnly|TestQQMediaErrors|TestSlowUpstreamWriteDoesNotStallOtherConversations|TestSlowReceiptDoesNotBlockOtherConversations|TestDisconnectDuringReceiptFailsWithoutReplay|TestRateLimitedSendIsSurfacedOnceWithoutReplay|TestCancelledMultiPartSendStopsRemainingBubbles|TestMediaStaysInItsOwnConversation|TestMediaOnlyTurnSendsNoEmptyBubble|TestDisconnectedReceiptsReleaseWithoutReplay|TestStopReleasesPendingReceipt|TestStopDuringReconnectDoesNotOpenNewSocket)$'
if [ -n "$negative" ]; then
  git show "$negative:bridge/platform/qq/qq.go" > "$evidence/qq.go"
  python3 - "$bridge/platform/qq/qq.go" "$evidence" <<'PY'
import json, pathlib, sys
source, directory = sys.argv[1:]
path = pathlib.Path(directory)
(path / 'overlay.json').write_text(json.dumps({'Replace': {source: str(path / 'qq.go')}}))
PY
  if go test -tags no_web -overlay="$evidence/overlay.json" ./platform/qq \
      -run '^(TestDisconnectedReceiptsReleaseWithoutReplay|TestStopReleasesPendingReceipt|TestStopDuringReconnectDoesNotOpenNewSocket)$' \
      -count=1 -timeout=30s -v > "$evidence/red.log" 2>&1; then
    echo "negative control unexpectedly passed" >&2; exit 1
  fi
  # A compiler failure or unrelated panic is not a valid negative control.
  for name in TestDisconnectedReceiptsReleaseWithoutReplay TestStopReleasesPendingReceipt TestStopDuringReconnectDoesNotOpenNewSocket; do
    grep -q -- "--- FAIL: $name " "$evidence/red.log" || { cat "$evidence/red.log"; exit 1; }
  done
  grep -- 'receipt_lifecycle_test.go:' "$evidence/red.log"
fi
go test -race -tags no_web ./platform/qq -run "$cases" -count=1 -timeout=180s -v > "$evidence/green.log" 2>&1 \
  || { cat "$evidence/green.log"; exit 1; }
grep -E -- '--- PASS:|^ok' "$evidence/green.log"
if [ -n "$binary" ]; then
  QQ_RESILIENCE_BINARY="$binary" go test -tags no_web ./platform/qq -run '^TestQQBinary(Media)?$' \
    -count=1 -timeout=90s -v > "$evidence/binary.log" 2>&1 || { cat "$evidence/binary.log"; exit 1; }
  cat "$evidence/binary.log"
fi
