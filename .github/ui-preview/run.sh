#!/usr/bin/env bash
# 用 PR 的代码构建前端与 cc-connect，在临时 HOME 里起一个隔离实例，截图到输出目录。
# 隔离：临时 HOME/XDG、管理页用系统分配的空闲端口、唯一平台是不连外网的 cloud_web
# gateway（不注册，出站地址指向本机 discard 端口）、agent 命令是一跑就失败的假 CLI，不会调用
# 任何模型。不读取任何密钥。
# 用法：run.sh <仓库根目录> <输出目录>
set -euo pipefail

REPO=$(cd "$1" && pwd)
mkdir -p "$2"
OUT=$(cd "$2" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)

WORK=$(mktemp -d "${TMPDIR:-/tmp}/conest-ui-preview-XXXXXX")
SANDBOX_HOME="$WORK/home"
mkdir -p "$SANDBOX_HOME" "$WORK/workdir" "$WORK/data"
BIN="$WORK/cc-connect-preview"
FAKE_AGENT="$WORK/fake-agent-cli"
printf '#!/bin/sh\nexit 1\n' > "$FAKE_AGENT" && chmod +x "$FAKE_AGENT"

echo "== 构建前端"
(cd "$REPO/bridge/web" && pnpm install --frozen-lockfile && pnpm build) > "$OUT/build-web.log" 2>&1 || { tail -n 50 "$OUT/build-web.log"; exit 1; }

echo "== 构建 cc-connect（嵌入前端）"
(cd "$REPO/bridge" && go build -o "$BIN" ./cmd/cc-connect) > "$OUT/build-go.log" 2>&1 || { tail -n 50 "$OUT/build-go.log"; exit 1; }

# 让系统分一个空闲端口，避免和开发机上正在跑的 cc-connect 冲突。
MGMT_PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
TOKEN="ui-preview-$(node -e 'console.log(require("crypto").randomUUID())')"
# listen 端口写 0 = 系统分配；base_url 指向本机 discard 端口（RFC 863 的 9 号），
# 即使有回复要发也出不了本机。
cat > "$WORK/config.toml" <<TOML
data_dir = "$WORK/data"

[log]
level = "info"

[management]
enabled = true
port = $MGMT_PORT
token = "$TOKEN"

[[projects]]
name = "ui-preview"

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "$WORK/workdir"
cmd = "$FAKE_AGENT"

[[projects.platforms]]
type = "cloud_web"

[projects.platforms.options]
token = "ui-preview-local"
transport = "gateway"
listen = "127.0.0.1:0"
base_url = "http://127.0.0.1:9"
TOML

echo "== 启动隔离 cc-connect（端口 $MGMT_PORT）"
# 只有 cc-connect 进程换到临时 HOME（构建和浏览器沿用 runner 的缓存目录），并清掉
# 指向真实会话、agent 目录和凭据的变量（与 bridge/tests/testutil/sandbox.go 的
# SandboxClearedVars 同一份清单）。
env -u CC_PROJECT -u CC_SESSION_KEY -u CC_DATA_DIR -u CC_CONFIG_PATH -u CC_CONNECT_CONFIG \
  -u CC_LOG_FILE -u CC_TEST_CONFIG -u CODEX_HOME -u CLAUDE_CONFIG_DIR -u PI_CODING_AGENT_DIR \
  -u KIMI_BIN -u OPENAI_API_KEY -u OPENAI_BASE_URL -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  -u ANTHROPIC_BASE_URL -u ANTHROPIC_BEDROCK_BASE_URL -u ANTHROPIC_BEDROCK_PROXY_BASE_URL \
  -u ANTHROPIC_FOUNDRY_API_KEY -u ANTHROPIC_FOUNDRY_BASE_URL \
  -u ANTHROPIC_FOUNDRY_PROXY_BASE_URL -u ANTHROPIC_VERTEX_BASE_URL \
  -u ANTHROPIC_VERTEX_PROXY_BASE_URL -u CLAUDE_CODE_OAUTH_TOKEN -u GEMINI_API_KEY \
  -u GOOGLE_API_KEY -u CURSOR_API_KEY -u KIMI_API_KEY -u WINDSURF_API_KEY \
  -u SHENGSUANYUN_API_KEY -u COPILOT_PROVIDER_API_KEY -u COPILOT_PROVIDER_BASE_URL \
  -u COPILOT_PROVIDER_BEARER_TOKEN -u MODEL_DISCOVERY_TOKEN -u CC_CONNECT_AGY_PERMISSION_TOKEN \
  -u TUITUI_APP_ID -u TUITUI_APP_SECRET -u MATRIX_CROSS_SIGNING_PASSWORD \
  HOME="$SANDBOX_HOME" USERPROFILE="$SANDBOX_HOME" \
  XDG_CONFIG_HOME="$SANDBOX_HOME/.config" XDG_DATA_HOME="$SANDBOX_HOME/.local/share" \
  XDG_STATE_HOME="$SANDBOX_HOME/.local/state" XDG_CACHE_HOME="$SANDBOX_HOME/.cache" \
  "$BIN" -config "$WORK/config.toml" > "$OUT/cc-connect.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

# 等管理页可访问；进程退出就立刻失败。总时长由 workflow 的 timeout-minutes 兜住。
until curl -fsS -o /dev/null "http://127.0.0.1:$MGMT_PORT/login" 2>/dev/null; do
  if ! kill -0 $PID 2>/dev/null; then echo "cc-connect 提前退出"; tail -n 50 "$OUT/cc-connect.log"; exit 1; fi
  sleep 1
done

echo "== 截图"
status=0
BASE_URL="http://127.0.0.1:$MGMT_PORT" TOKEN="$TOKEN" PROJECT="ui-preview" OUT="$OUT" node "$HERE/shoot.mjs" || status=$?

# 产物里不留 token
for f in "$OUT"/*.log; do
  sed "s/$TOKEN/<token>/g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
ls -1 "$OUT"
exit $status
