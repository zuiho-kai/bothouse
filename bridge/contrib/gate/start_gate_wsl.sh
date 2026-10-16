# 由 gate_switch.py 通过 `ssh <host> wsl bash -s < start_gate_wsl.sh` 在 WSL 里前台运行。
# 注意：SSH 断开后 WSL 不一定会结束这个进程（2026-10-16 实测残留过），
# 所以启动前先清理本目录留下的旧闸门，离开局域网时由 stop_gate_wsl.sh 主动按 PID 结束。
set -e
D="${GATE_DIR:-$HOME/work/gate-cuda-20261016-155207}"
PORT="${GATE_PORT:-9930}"
cd "$D"

# 端口被占：是本目录的旧闸门就按 PID 结束；是别的程序就报错退出，不动它
for pid in $(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  if [ "$cwd" = "$(readlink -f "$D")" ] && grep -q "gate.py" "/proc/$pid/cmdline" 2>/dev/null; then
    echo "[$(date '+%F %T')] 结束残留的旧闸门 PID $pid"
    kill "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  else
    echo "[$(date '+%F %T')] 端口 $PORT 被其他程序占用（PID $pid，目录 $cwd），不启动" >&2
    exit 3
  fi
done

export GATE_MODEL="${GATE_MODEL:-$HOME/models/Qwen3.5-4B}"
export GATE_TEAM="$D/gate-team.json"
export GATE_LOG="$D/gate.jsonl"
echo "[$(date '+%F %T')] 启动闸门：$D，模型 $GATE_MODEL"
exec "$HOME/venvs/gate/bin/python" -u gate.py
