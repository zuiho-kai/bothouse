# 云端频道 hub 镜像。Python 3.12：和本机 uv 环境同版本（.venv 是 cpython-3.12）。
FROM python:3.12-slim
# 版本同 uv.lock。
RUN pip install --no-cache-dir aiohttp==3.14.5
WORKDIR /app
COPY rh /app/rh
COPY avatars /app/avatars
# 端口 8790：实现者定，vps-arm 上未占用、外网实测可达（2026-10-18）。
CMD ["python", "-m", "rh.hub", "--host", "0.0.0.0", "--port", "8790", "--db", "/data/hub.sqlite3"]
