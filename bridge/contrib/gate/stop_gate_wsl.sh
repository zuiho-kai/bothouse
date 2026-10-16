# 由 gate_switch.py 在离开局域网或退出时调用：按 PID 结束本目录启动的闸门，释放显存。
D="${GATE_DIR:-$HOME/work/gate-cuda-20261016-155207}"
target=$(readlink -f "$D")
for pid in $(pgrep -f "gate.py" 2>/dev/null); do
  [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$target" ] || continue
  echo "[$(date '+%F %T')] 结束闸门 PID $pid"
  kill "$pid"
done
