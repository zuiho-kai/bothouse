# 云端频道 hub 镜像。Python 3.12：和本机 uv 环境同版本（.venv 是 cpython-3.12）。
FROM python:3.12-slim
# 版本同 uv.lock。
# cryptography：手机通知的加密和 VAPID 签名（rh/webpush.py）；cffi 是它的依赖，版本也照 uv.lock 钉住。
RUN pip install --no-cache-dir aiohttp==3.14.5 cryptography==50.0.2 cffi==2.1.1
WORKDIR /app
COPY rh /app/rh
COPY avatars /app/avatars
# 只听本机 127.0.0.1:8791，外面只能经 vps-arm 上的 nginx https（443）进来；旧 http://IP:8790 由 nginx 301 跳到 https
# （/etc/nginx/sites-available/rh-hub.step2，2026-10-20 用户同意上 https）。8791：nginx 第二步配置定的，vps-arm 上 `ss -ltnp` 未占用。
CMD ["python", "-m", "rh.hub", "--host", "127.0.0.1", "--port", "8791", "--db", "/data/hub.sqlite3"]
