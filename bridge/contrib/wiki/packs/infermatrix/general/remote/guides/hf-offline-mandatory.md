---
name: hf-offline-mandatory
description: 远端 HF 加载必须 OFFLINE：offline 三件套或本地绝对快照路径、cache env 打印与 local_files_only 探针、三层防御、新会话验证、设了 HF_HOME 仍会联网校验重下的原因
metadata:
  scope: 只收远端 / 容器内 HF 模型加载前的 offline 设置、cache 验证和探针规则及其踩坑；cache 路径被 TRANSFORMERS_CACHE / HF_HUB_CACHE 覆盖归 container-setup
---
# 远端 HF 加载必须 OFFLINE

## 关键事实

- 源页：`knowledge/general/remote/guides/hf-offline-mandatory.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 规则

- 任何远端 / 容器内的 HF 模型加载入口（`Omni()` / `from_pretrained()` / `LLM()` / `AutoTokenizer.from_pretrained()`）启动前**必须**两条并行设置：

```bash
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
# datasets 也用时加上：
export HF_DATASETS_OFFLINE=1
```

- 或者直接传**本地绝对快照路径**：

```python
omni = Omni(model="/data/models/hub/models--<org>--<repo>/snapshots/<commit_hash>", ...)
# 而不是
omni = Omni(model="<org>/<repo>", ...)  # ← 哪怕 HF_HOME 指向已有 cache，仍可能联网
```

- 远端 GPU / e2e / 大模型 pytest 不允许只靠“应该有 cache”开跑。必须先打印并验证 cache env：

```bash
export HF_HOME=/data/models
export HF_HUB_CACHE=/data/models/hub
export HF_MODULES_CACHE=/data/models/modules
export TRANSFORMERS_CACHE=/data/models/hub
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
```

- 然后用 `local_files_only=True` 做本地探针；探针失败就停止：

```bash
python - <<'PY'
from huggingface_hub import snapshot_download
print(snapshot_download(
    "tencent/HunyuanImage-3.0-Instruct",
    cache_dir="/data/models/hub",
    local_files_only=True,
))
PY
```

- 默认 cache 指向 `/data/models`。
- 如果 `/root/.cache/huggingface` 已经有完整模型，可以只读复用；但必须先过 `local_files_only=True` 或本地绝对 snapshot 路径验证。
- `/root/.cache` 不存在、缺 shard、需要写入、需要补下载、或被当作新建私有 cache root 时，禁止启动模型加载命令。

### How to apply

#### 触发场景

- 远端 / 容器内**任何** `python ... profile / bench / generate / inference` 命令
- 远端 `LLM(...)` / `Omni(...)` / `from_pretrained(...)` 调用前
- 写远端启动包装脚本时（`run_remote.sh` 等）

#### 三层防御

1. **shell export**：每次 SSH 进容器 / 进 venv 后第一组命令里加：
   ```bash
   export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_DATASETS_OFFLINE=1
   ```
2. **包装脚本兜底**：远端启动脚本统一封装，offline 三件套写死：
   ```bash
   #!/bin/bash
   set -e
   export HF_HUB_OFFLINE=1
   export TRANSFORMERS_OFFLINE=1
   export HF_DATASETS_OFFLINE=1
   # 校验快照存在，否则拒绝运行
   SNAP="$HF_HOME/hub/models--<org>--<repo>/snapshots"
   [ -d "$SNAP" ] || { echo "FATAL: snapshot missing at $SNAP"; exit 2; }
   exec "$@"
   ```
3. **传本地绝对路径**：测试脚本里直接给 `model=` 一个 `/data/models/hub/.../snapshots/<hash>` 的具体路径，连 repo id 都不写。

#### 验证（每次新 venv / 新会话第一条命令）

```bash
env | grep -E "HF_HUB_OFFLINE|TRANSFORMERS_OFFLINE|HF_HOME|HF_HUB_CACHE|HF_MODULES_CACHE|TRANSFORMERS_CACHE|XDG_CACHE_HOME"
# 期望同时看到：
#   HF_HUB_OFFLINE=1
#   TRANSFORMERS_OFFLINE=1
#   HF_HOME=<existing cache root>
```

- 任何一个缺失就**别跑模型加载命令**。
- 远端大模型 e2e 还必须在开跑前记录：

```text
workdir / venv / python
df -h
nvidia-smi
CUDA_VISIBLE_DEVICES
target model local path under /data/models or /root/.cache/huggingface
/root/.cache/huggingface will be used: no / readonly existing cache only
local_files_only probe result
```

### 相关

- container_setup（[[container-setup]]）§2：`TRANSFORMERS_CACHE` / `HF_HUB_CACHE` 优先级覆盖 `HF_HOME`（同根问题：cache 配置不到位）
- CLAUDE.md A11

## 决策与踩坑

### Why

- **设了 `HF_HOME` 不等于不联网**。即使 `$HF_HOME/hub/models--<org>--<repo>/snapshots/<hash>/` 完整存在：
  - HF Hub 库仍会去 hub.huggingface.co 校验该 revision 是否有更新
  - 任何 shard 不齐 / 哈希校验失败 → 自动重新下载
  - 远端节点墙外网络 + 大模型（HunyuanImage-3.0-Instruct AR ~160GB） → **网络打满 + 磁盘 IO 打爆 → SSH 抖到 kex_exchange_identification 断开**
- 这跟 `TRANSFORMERS_CACHE / HF_HUB_CACHE 覆盖 HF_HOME` 的坑（A8 / container_setup §2，见 [[container-setup]]）是**两件事**：
  - A8 是「路径被覆盖找不到 cache」
  - 本条是「路径对，但仍联网校验导致重下」

### 历史踩坑

- 2026-05-14 <REMOTE_WORK_ROOT> 新建 venv 跑 profile_ar.py，只设 `HF_HOME=/data/models` 没设 offline，模型疑似触发重新下载 → 磁盘 IO + 网络拉满 → SSH `kex_exchange_identification: Connection closed by remote host`，5 分钟内连不上服务器
- 2026-06-22 远端 Hunyuan e2e 只把 HF/cache 规则当背景约束，未先检查 `/data/models` 或可只读复用的 `/root/.cache/huggingface`、cache env、磁盘、GPU，也未做 `local_files_only` 探针；流程直接进入建 venv / pytest，造成缺 cache 时重复下载风险
- 类似坑参见 container_setup（[[container-setup]]）§2（cache 路径覆盖）
