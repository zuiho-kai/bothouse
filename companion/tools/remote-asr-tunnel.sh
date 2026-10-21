#!/bin/bash
# Keep the remote recognizer (tools/remote_asr_server.py in WSL on the GPU laptop) running and
# forwarded to this Mac: http://127.0.0.1:19940/transcribe. WSL kills background processes when
# the SSH session ends, so the session itself is the server's lifetime; reconnect when it drops.
#
#   REMOTE_ASR_HOST=zxy@100.97.84.11 REMOTE_ASR_DIR=/home/zxy/work/asr-remote-20261021 \
#     companion/tools/remote-asr-tunnel.sh
set -u
HOST=${REMOTE_ASR_HOST:?set REMOTE_ASR_HOST, e.g. zxy@100.97.84.11}
DIR=${REMOTE_ASR_DIR:?set REMOTE_ASR_DIR, the WSL work dir holding venv3 and remote_asr_server.py}
LOCAL_PORT=${REMOTE_ASR_LOCAL_PORT:-19940}
REMOTE_PORT=${REMOTE_ASR_PORT:-9940}

while true; do
  echo "$(date '+%F %T') connecting $HOST"
  ssh -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
      -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" "$HOST" "wsl -e bash -s" <<EOF
cd "$DIR" || exit 1
SP=$DIR/venv3/lib/python3.12/site-packages
export LD_LIBRARY_PATH=\$SP/nvidia/cublas/lib:\$SP/nvidia/cudnn/lib:\${LD_LIBRARY_PATH:-}
export HF_HUB_OFFLINE=1 HF_HUB_DISABLE_PROGRESS_BARS=1
exec venv3/bin/python remote_asr_server.py --port $REMOTE_PORT
EOF
  echo "$(date '+%F %T') tunnel ended (exit $?), retrying in 5s"
  sleep 5
done
