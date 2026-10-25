#!/usr/bin/env bash
# 起/停一份隔离的自建平台实例：dsh 频道页（conest-collab 插件）+ cc-connect（cloud_web）+ 两个假 agent。
# 主路回归（run.sh）和常驻预览实例共用这一份。
#
# 用法：
#   instance.sh start <仓库根目录> <实例目录> [--host <地址>] [--port <端口>]
#   instance.sh stop  <实例目录>
#
# 隔离：dsh 和 cc-connect 都用 env -i 起，HOME/DSH_HOME/数据目录全在 <实例目录> 里；
# 端口不给就让系统挑一个空闲的；agent 是 fake_agent.py，不调用任何模型、不读任何密钥。
# 依赖：go、node、pnpm、dsh（DeepSeek Harness）、python3 在 PATH 上。
# pnpm 的包缓存放在 $BH_E2E_CACHE（默认 ${TMPDIR:-/tmp}/bothouse-e2e-cache），重复跑不必重新下载。
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
CMD=${1:?用法见文件头}

stop_instance() {
  local root=$1 f pg
  for f in "$root/run/cc.pid" "$root/run/dsh.pid"; do
    [ -f "$f" ] || continue
    pg=$(cat "$f")
    # 旧 pid 文件（崩溃/重启机器后留下）里的号可能已被无关进程复用：组长的命令行或环境
    # （ps -E，同用户进程可见）里要含本实例目录（cc-connect 的 --config、dsh 的 HOME/数据目录），否则只删 pid 文件不发信号。
    if ! ps -E -ww -o command= -p "$pg" 2>/dev/null | grep -qF "$root"; then
      rm -f "$f"; continue
    fi
    # 进程是用 setsid 起的，pid 即进程组号，整组杀掉（含 dsh 的 node 子进程和假 agent）。
    kill -TERM -- "-$pg" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$pg" 2>/dev/null || break; sleep 0.5; done
    kill -KILL -- "-$pg" 2>/dev/null || true
    rm -f "$f"
  done
}

if [ "$CMD" = stop ]; then
  stop_instance "$(cd "${2:?缺实例目录}" && pwd)"
  exit 0
fi
[ "$CMD" = start ] || { echo "未知命令：$CMD" >&2; exit 2; }

REPO=$(cd "${2:?缺仓库根目录}" && pwd)
mkdir -p "${3:?缺实例目录}"
ROOT=$(cd "$3" && pwd)
shift 3
HOST=127.0.0.1
PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

for b in go node pnpm dsh python3; do
  command -v "$b" >/dev/null || { echo "缺命令：$b" >&2; exit 2; }
done

CACHE=${BH_E2E_CACHE:-${TMPDIR:-/tmp}/bothouse-e2e-cache}
H="$ROOT/home"
mkdir -p "$ROOT/run" "$ROOT/log" "$ROOT/bin" "$H" "$ROOT/data/collab" "$ROOT/data/bh" "$ROOT/data/cc" \
  "$ROOT/work" "$ROOT/docs" "$CACHE"

# 进程只拿到这几个变量（PATH 用于找 node/dsh/python3），其余一律清掉。
ISO=(env -i BOTHOUSE_TRAY=off PATH="$PATH" HOME="$H" TMPDIR="${TMPDIR:-/tmp}" LANG=en_US.UTF-8
  XDG_CONFIG_HOME="$H/.config" XDG_DATA_HOME="$H/.local/share" XDG_STATE_HOME="$H/.local/state"
  XDG_CACHE_HOME="$H/.cache" DSH_HOME="$H/.dsh" npm_config_store_dir="$CACHE/pnpm-store")

echo "== 构建 cc-connect"
(cd "$REPO/bridge" && go build -tags no_web -o "$ROOT/bin/cc-connect.new" ./cmd/cc-connect) >"$ROOT/log/build.log" 2>&1 \
  || { tail -n 30 "$ROOT/log/build.log"; exit 1; }
# 编译过了才停旧实例（常驻预览：新提交编不过时旧实例照常可用）。
stop_instance "$ROOT"
mv "$ROOT/bin/cc-connect.new" "$ROOT/bin/cc-connect"

echo "== 装频道页插件（产品同款 dsh_bundle/install.sh）"
rm -rf "$ROOT/bundle"
cp -R "$REPO/bridge/core/dsh_bundle" "$ROOT/bundle"
"${ISO[@]}" bash "$ROOT/bundle/install.sh" web --lang zh >"$ROOT/log/install.log" 2>&1 \
  || { tail -n 30 "$ROOT/log/install.log"; exit 1; }
# 首次建工作区时 dsh 默认去问系统「文稿」目录；指到实例目录里，避免碰真实 ~/Documents。
cat >"$H/.dsh/profiles/web/cordis.patch.yml.e2e" <<YML
- id: workspace-controller
  config:
    documentsDirectory: $ROOT/docs
YML
node -e '
const fs=require("fs");const [f,add]=process.argv.slice(1);
let s=fs.existsSync(f)?fs.readFileSync(f,"utf8"):"[]\n";
if(!s.includes("documentsDirectory")){s=s.replace(/^\[\]\s*$/m,"")+fs.readFileSync(add,"utf8");fs.writeFileSync(f,s);}
' "$H/.dsh/profiles/web/cordis.patch.yml" "$H/.dsh/profiles/web/cordis.patch.yml.e2e"
rm -f "$H/.dsh/profiles/web/cordis.patch.yml.e2e"

[ -n "$PORT" ] || PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
BOT_TOKEN=$(cat "$ROOT/run/bot-token" 2>/dev/null || node -e 'console.log(require("crypto").randomUUID())')
echo "$BOT_TOKEN" >"$ROOT/run/bot-token"
# 主角色 = 项目 ju（橘）；队友 = 项目 dev（龙）。
[ -f "$ROOT/data/bh/lead.json" ] || echo '{"lead":"ju"}' >"$ROOT/data/bh/lead.json"

SETSID=(python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])')

echo "== 启动 dsh 频道页（$HOST:$PORT）"
: >"$ROOT/log/dsh.log"
# setsid 让 pid 即进程组号，stop 时整组杀；stdin/stdout 都不留给调用方，免得调用方的管道等不到 EOF。
cd "$ROOT/work"
"${SETSID[@]}" "${ISO[@]}" CONEST_COLLAB_DATA="$ROOT/data/collab" CONEST_COLLAB_WORKSPACE="$ROOT/work" \
  BOTHOUSE_DATA_DIR="$ROOT/data/bh" CONEST_LEAD_FILE="$ROOT/data/bh/lead.json" CONEST_COLLAB_BOT_TOKEN="$BOT_TOKEN" \
  dsh --profile web --no-open --host "$HOST" --port "$PORT" >>"$ROOT/log/dsh.log" 2>&1 </dev/null &
echo $! >"$ROOT/run/dsh.pid"
for _ in $(seq 1 120); do
  grep -q '^dsh web: http' "$ROOT/log/dsh.log" && break
  kill -0 "$(cat "$ROOT/run/dsh.pid")" 2>/dev/null || { tail -n 30 "$ROOT/log/dsh.log"; exit 1; }
  sleep 0.5
done
URL=$(grep -m1 '^dsh web: http' "$ROOT/log/dsh.log" | awk '{print $3}')
[ -n "$URL" ] || { echo "dsh 60 秒内没打印登录地址" >&2; tail -n 30 "$ROOT/log/dsh.log"; exit 1; }
echo "$URL" >"$ROOT/run/login-url"
BASE="http://$HOST:$PORT"
WSBASE="ws://$HOST:$PORT"
case "$HOST" in *:*) BASE="http://[$HOST]:$PORT"; WSBASE="ws://[$HOST]:$PORT" ;; esac

fake() { # fake <角色> <文件>
  printf '#!/bin/sh\nFAKE_ROLE=%s FAKE_LEAD=橘 FAKE_TEAMMATE=龙 FAKE_LOG=%s exec python3 %s "$@"\n' \
    "$1" "$ROOT/log/fake-agent.log" "$HERE/fake_agent.py" >"$2"
  chmod +x "$2"
}
fake lead "$ROOT/bin/fake-lead"
fake dev "$ROOT/bin/fake-dev"

project() { # project <名> <显示名urlencoded> <假agent>
  cat <<TOML

[[projects]]
name = "$1"

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "$ROOT/work"
cmd = "$3"
mode = "bypassPermissions"

[[projects.platforms]]
type = "cloud_web"

[projects.platforms.options]
transport = "websocket"
token = "$BOT_TOKEN"
base_url = "$BASE"
ws_url = "$WSBASE/cloud-web/ws?bot=$1&name=$2"
allow_from = "*"
share_session_in_channel = true
group_reply_all = false
TOML
}
{
  printf 'data_dir = "%s"\nlanguage = "zh"\n' "$ROOT/data/cc"
  project ju '%E6%A9%98' "$ROOT/bin/fake-lead"
  project dev '%E9%BE%99' "$ROOT/bin/fake-dev"
} >"$ROOT/cc.toml"

echo "== 启动 cc-connect（两个假 agent）"
cd "$ROOT"
"${SETSID[@]}" "${ISO[@]}" "$ROOT/bin/cc-connect" --config "$ROOT/cc.toml" >>"$ROOT/log/cc.log" 2>&1 </dev/null &
echo $! >"$ROOT/run/cc.pid"
echo "$BASE" >"$ROOT/run/base-url"
echo "== 已启动：$BASE（登录地址见 $ROOT/run/login-url）"
