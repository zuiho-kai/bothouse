#!/usr/bin/env bash
# 自建平台主路回归（合入前的快速检查）：在临时目录起一份隔离实例（dsh 频道页 + cc-connect + 假 agent），
# 在频道页对主角色说一句 → 主角色 @ 派队友 → 队友交回 → 主角色汇总 → 都回同一页，
# 桌面和 390x844 各截一张图，最后打印 PASS/FAIL，退出码 0/1。
#
# 用法：bridge/tests/selfhost_mainpath/run.sh [输出目录]
#   输出目录默认临时目录；里面有截图、result.json、各进程日志（log/）。
#   KEEP=1 跑完不停实例，方便手动看。
# 依赖：go、node、pnpm、dsh、python3；playwright 装在 $BH_E2E_CACHE/pw（首次自动装）。
# 只用假 agent，验不了真实模型；合入后仍要在真实入口验收。
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
CACHE=${BH_E2E_CACHE:-${TMPDIR:-/tmp}/bothouse-e2e-cache}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/bothouse-mainpath-XXXXXX")
OUT=${1:-$WORK/out}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

cleanup() {
  if [ "${KEEP:-}" = 1 ]; then
    echo "== KEEP=1，实例留着：$(cat "$WORK/inst/run/base-url" 2>/dev/null)；停：$HERE/instance.sh stop $WORK/inst"
  else
    "$HERE/instance.sh" stop "$WORK/inst" || true
  fi
  cp -R "$WORK/inst/log" "$OUT/" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -d "$CACHE/pw/node_modules/playwright" ] || ! cmp -s "$HERE/package.json" "$CACHE/pw/package.json"; then
  echo "== 装 playwright 到 $CACHE/pw"
  mkdir -p "$CACHE/pw" && cp "$HERE/package.json" "$CACHE/pw/"
  (cd "$CACHE/pw" && npm install --no-audit --no-fund && npx playwright install chromium) >"$OUT/playwright-install.log" 2>&1 \
    || { tail -n 20 "$OUT/playwright-install.log"; echo FAIL; exit 1; }
fi

"$HERE/instance.sh" start "$REPO" "$WORK/inst" || { echo "FAIL（实例没起来）"; exit 1; }

echo "== 走主路"
ln -sfn "$CACHE/pw/node_modules" "$WORK/node_modules"
cp "$HERE/drive.mjs" "$WORK/drive.mjs"
if LOGIN_URL=$(cat "$WORK/inst/run/login-url") OUT="$OUT" node "$WORK/drive.mjs"; then
  echo "截图：$OUT/mainpath-desktop.png $OUT/mainpath-mobile-390x844.png"
  echo PASS
else
  echo "详情：$OUT/result.json，日志：$OUT/log/"
  echo FAIL
  exit 1
fi
