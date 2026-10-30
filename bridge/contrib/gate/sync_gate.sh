#!/bin/bash
# 一键同步闸门：gate.py / scorer_torch.py / gate-team.json 改了以后运行。
#   bash ~/cc-connect/contrib/gate/sync_gate.sh
# 顺序很重要：先停切换器（它退出时会按 PID 停掉 Windows 上旧目录的闸门），
# 再部署到 Windows 的一个新目录（不覆盖旧目录），改脚本默认目录，最后启动切换器。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# 必须给：GPU 机器的 SSH 目标、它的 Windows 用户目录在 WSL 里的路径（scp 传到 Windows 用户目录）
HOST="${SWITCH_HOST:?先设 SWITCH_HOST=<user@GPU 机器>（SSH 目标）}"
: "${SWITCH_TS_IP:?先设 SWITCH_TS_IP=<GPU 机器的 tailscale IP>（第 4 步启动的切换器要用）}"
WIN_HOME="${SWITCH_WIN_HOME:?先设 SWITCH_WIN_HOME=<WSL 里看到的 Windows 用户目录，形如 /mnt/c/Users/<你的用户名>>}"
TEAM="${GATE_TEAM_FILE:-$HOME/.cc-connect/gate-team.json}"  # 默认：向导写的团队文件
PORT="${SWITCH_PORT:-9930}"
NAME="gate-cuda-$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$TEAM" || { echo "团队文件不是合法 JSON：$TEAM"; exit 1; }

# 1. 停切换器
PID="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -n "$PID" ]; then
  echo "停切换器 PID $PID"
  kill "$PID"
  for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
  kill -0 "$PID" 2>/dev/null && { echo "切换器 30 秒没退出，停止同步"; exit 1; }
fi

# 2. 打包并部署到 Windows 新目录
mkdir -p "$TMP/$NAME"
cp "$HERE/gate.py" "$TMP/$NAME/gate.py"
cp "$HERE/scorer_torch.py" "$TMP/$NAME/scorer.py"
# gate.py 运行时要的其他本地模块（ctxsvc 又用到 wiki_search）。test_gate_switch.py 检查这份清单是否齐全。
GATE_MODULES="ctxsvc.py scorer_remote.py wiki_search.py"
for f in $GATE_MODULES; do cp "$HERE/$f" "$TMP/$NAME/$f"; done
cp "$TEAM" "$TMP/$NAME/gate-team.json"
COPYFILE_DISABLE=1 tar -C "$TMP" -czf "$TMP/$NAME.tgz" "$NAME"
scp -q -o BatchMode=yes "$TMP/$NAME.tgz" "$HOST:$NAME.tgz"
cat > "$TMP/deploy.sh" <<EOF
set -e
D=\$HOME/work/$NAME
[ -e "\$D" ] && { echo "\$D 已存在，不覆盖"; exit 1; }
mkdir -p "\$D" && tar -xzf $WIN_HOME/$NAME.tgz -C "\$D" --strip-components=1 2>/dev/null
echo "已部署到 \${D}：\$(ls "\$D" | tr '\n' ' ')"
EOF
ssh -o BatchMode=yes "$HOST" wsl bash -s < "$TMP/deploy.sh"

# 3. 启动/停止脚本指向新目录
sed -i '' -E "s#(GATE_DIR:-\\\$HOME/work/)[^}]*}#\1$NAME}#" "$HERE/start_gate_wsl.sh" "$HERE/stop_gate_wsl.sh"
grep -h "GATE_DIR:-" "$HERE/start_gate_wsl.sh"

# 4. 启动切换器（不挂在任何会话上）
mkdir -p "$HOME/.cc-connect-gate-switch"
nohup python3 -u "$HERE/gate_switch.py" > "$HOME/.cc-connect-gate-switch/switch.out" 2>&1 &
echo "切换器已启动 PID $!，等待远端闸门加载…"
for _ in $(seq 1 40); do
  s="$(curl -s -m 2 "localhost:$PORT/status" || true)"
  case "$s" in *'"mode": "gpu"'*) echo "$s"; exit 0;; esac
  sleep 3
done
echo "2 分钟内没进入 GPU 模式（离线时这是正常的，会用本地规则）：$s"
