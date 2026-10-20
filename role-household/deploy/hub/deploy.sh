#!/bin/sh
# 把云端频道部署到 vps-arm:/opt/role-household-hub，并把 token 同步到本机 .env（不打印 token）。
#   sh deploy/hub/deploy.sh
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEST=/opt/role-household-hub
ssh vps-arm "mkdir -p $DEST/data"
rsync -a --delete --exclude __pycache__ "$ROOT/rh/" "vps-arm:$DEST/rh/"
rsync -a --delete "$ROOT/avatars/" "vps-arm:$DEST/avatars/"   # 表盘页 /dial 的头像图
rsync -a "$ROOT/deploy/hub/Dockerfile" "$ROOT/deploy/hub/compose.yaml" "vps-arm:$DEST/"
# 第一次部署生成 token（32 字节随机，实现者定）；之后保留原 token。
ssh vps-arm "cd $DEST && [ -f hub.env ] || (umask 077 && echo RH_HUB_TOKEN=\$(openssl rand -hex 32) > hub.env)"
ssh vps-arm "cd $DEST && docker compose up -d --build"
TOKEN_LINE=$(ssh vps-arm "cat $DEST/hub.env")
umask 077
# 云端地址取 ssh 配置里 vps-arm 的 HostName，不把公网 IP 写进仓库（审查第 9 条）。
# https 走 vps-arm 上的 nginx 443（Let's Encrypt 给 IP 签的证书，2026-10-20），nginx 反代到容器端口（同 Dockerfile）。
HUB_IP=$(ssh -G vps-arm | awk '/^hostname /{print $2}')
# 只换 RH_HUB_URL / RH_HUB_TOKEN（和 hub.env 里有的话 RH_BOT_TOKEN）这几行，.env 里其他配置（如 RH_DISCORD_WEBHOOK）保留。
# RH_BOT_TOKEN 是 cc-connect 的 bot 连 hub 用的（rh/hub.py Hub.bot_token），不自动生成：要先把 cc-connect 的配置换过去再加。
{ grep -v -E '^(RH_HUB_URL|RH_HUB_TOKEN|RH_BOT_TOKEN)=' "$ROOT/.env" 2>/dev/null || true
  echo "RH_HUB_URL=https://$HUB_IP"; echo "$TOKEN_LINE"; } > "$ROOT/.env.tmp"
mv "$ROOT/.env.tmp" "$ROOT/.env"
echo "已部署；token 已写入 $ROOT/.env"
