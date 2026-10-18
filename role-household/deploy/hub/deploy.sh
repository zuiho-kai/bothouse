#!/bin/sh
# 把云端频道部署到 vps-arm:/opt/role-household-hub，并把 token 同步到本机 .env（不打印 token）。
#   sh deploy/hub/deploy.sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEST=/opt/role-household-hub
ssh vps-arm "mkdir -p $DEST/data"
rsync -a --delete --exclude __pycache__ "$ROOT/rh/" "vps-arm:$DEST/rh/"
rsync -a "$ROOT/deploy/hub/Dockerfile" "$ROOT/deploy/hub/compose.yaml" "vps-arm:$DEST/"
# 第一次部署生成 token（32 字节随机，实现者定）；之后保留原 token。
ssh vps-arm "cd $DEST && [ -f hub.env ] || (umask 077 && echo RH_HUB_TOKEN=\$(openssl rand -hex 32) > hub.env)"
ssh vps-arm "cd $DEST && docker compose up -d --build"
TOKEN_LINE=$(ssh vps-arm "cat $DEST/hub.env")
umask 077
# 云端地址取 ssh 配置里 vps-arm 的 HostName，不把公网 IP 写进仓库（审查第 9 条）。端口同 Dockerfile。
HUB_IP=$(ssh -G vps-arm | awk '/^hostname /{print $2}')
{ echo "RH_HUB_URL=http://$HUB_IP:8790"; echo "$TOKEN_LINE"; } > "$ROOT/.env"
echo "已部署；token 已写入 $ROOT/.env"
