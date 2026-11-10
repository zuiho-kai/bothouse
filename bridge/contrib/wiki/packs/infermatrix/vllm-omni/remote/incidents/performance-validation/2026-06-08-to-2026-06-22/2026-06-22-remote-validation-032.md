---
name: 2026-06-22-remote-validation-032
description: 2026-06-22 错题：远端 HunyuanImage-3.0-Instruct 等 100GB+ 模型 e2e 前未先证明 HF cache 只读可复用，直接建 venv 跑 pytest 有重复下载风险；含预检摘要、/data/models 共享 cache 与 HF_HUB_OFFLINE=1 强制、snapshot_download local_files_only 探针
metadata:
  scope: 只收 2026-06-22 大模型 e2e 前未做 cache 门禁这一起事故；共享 HF cache 路径写错的同类问题见 2026-06-16-remote-validation-030-1
---
# 2026-06-22 — 远端 Hunyuan e2e 未先证明 cache 只读可复用，缺 cache 时触发重复下载风险

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-22-remote-validation-032.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-22-remote-validation-032`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：远端 Hunyuan e2e 未先证明 cache 只读可复用，缺 cache 时触发重复下载风险
- 影响范围：repos/vllm-omni/remote

### 症状

- 远端跑 HunyuanImage-3.0-Instruct 这类 100GB+ 大模型 e2e 时，前置检查没有真正执行到位。流程直接进入建 venv、装包、跑 pytest，导致 HuggingFace 可能走 `/root/.cache/huggingface` 或默认 cache 路径；如果那里已有完整模型，本可以只读复用，但如果没有就会触发重复下载。

### 根因

- `CLAUDE.md` 已经写了 HF offline/cache 规则，但执行时只把它当背景约束，没有变成跑命令前必须打勾的阻塞检查。
- 只执行了 git/DCO/push 这类显性规则；远端 GPU/e2e 阶段没有重新读取并落实模型缓存门禁。
- 没有先证明 `HF_HOME`、`HF_HUB_CACHE`、`HF_MODULES_CACHE`、`TRANSFORMERS_CACHE` 都指向宿主共享路径，也没有用 `local_files_only=True` 或本地 snapshot 路径证明模型已存在。

### 硬规则

- 远端 GPU / e2e / 大模型 pytest 开跑前必须先输出预检摘要；摘要缺项就不准跑：

```text
workdir:
venv/python:
df -h:
nvidia-smi:
CUDA_VISIBLE_DEVICES:
HF_HOME:
HF_HUB_CACHE:
HF_MODULES_CACHE:
TRANSFORMERS_CACHE:
XDG_CACHE_HOME:
target model local path:
/root/.cache/huggingface will be used: no / readonly existing cache only
local_files_only probe: pass/fail
command to run:
```

- 默认强制使用共享 cache 和离线模式：

```bash
export HF_HOME=/data/models
export HF_HUB_CACHE=/data/models/hub
export HF_MODULES_CACHE=/data/models/modules
export TRANSFORMERS_CACHE=/data/models/hub
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
```

- 如果 `/root/.cache/huggingface` 已经有完整模型，也可以只读复用，但必须满足两个条件：
  - `local_files_only=True` 或本地绝对 snapshot 路径验证通过。
  - 不允许任何写入、新建 cache root、补 shard 或联网下载。
- 模型存在性必须用本地探针验证，而不是相信目录名：

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

- 如果这一步失败，说明下一步会联网或补 shard，必须停下来修 cache/env/snapshot，不能继续跑 pytest、serve、generate 或 benchmark。

### 怎么避免

- 把“先检查模型和 cache”从自然语言提醒升级成阻塞门禁：先查 `/data/models`、`/root/.cache/huggingface` 里是否已有可复用模型、cache env、磁盘、GPU，再做离线探针，最后才允许开跑。任何会自动下载模型的命令都必须在 `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1` 下运行；本地没有模型就让命令失败，不允许偷偷下载。
