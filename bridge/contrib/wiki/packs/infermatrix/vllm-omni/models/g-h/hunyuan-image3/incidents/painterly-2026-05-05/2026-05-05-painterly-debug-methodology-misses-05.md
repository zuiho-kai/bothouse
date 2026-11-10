---
name: 2026-05-05-painterly-debug-methodology-misses-05
description: 2026-05-05 在 vllm_omni/__init__.py 一次翻 cudnn.deterministic、benchmark、TF32 等 5 个旋钮并设 CUBLAS_WORKSPACE_CONFIG=:4096:8，HunyuanImage3 的 Conv3d 在 cuDNN 9 / CUDA 13 无 deterministic 实现，worker 崩溃连带整个容器死、用户被迫重申请；解法是 L1-L3 分级单步翻，永不加 deterministic 与 CUBLAS_WORKSPACE_CONFIG
metadata:
  scope: 只收一次翻多个 cuDNN/CUBLAS 旋钮把容器跑崩这一条；远端 patch 未回退归 2026-05-05-painterly-debug-methodology-misses-04，根因与总览归 painterly-overview
---
# 2026-05-05 — 一次翻 5 个 cuDNN/CUBLAS 旋钮 + CUBLAS_WORKSPACE_CONFIG，把容器跑崩

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-05-painterly-debug-methodology-misses-05.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-05-painterly-debug-methodology-misses-05`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：一次翻 5 个 cuDNN/CUBLAS 旋钮 + CUBLAS_WORKSPACE_CONFIG，把容器跑崩
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：为了试 cuDNN 9 / TF32 / autotuning 是不是 painterly 来源，在 `vllm_omni/__init__.py` 加了 env-gated 一次性翻 5 个旋钮：

```python
cudnn.deterministic = True
cudnn.benchmark = False
cuda.matmul.allow_tf32 = False
cudnn.allow_tf32 = False
set_float32_matmul_precision('highest')
```

- 配 `CUBLAS_WORKSPACE_CONFIG=:4096:8` 一起跑 IT2I。后台启动 + sleep 200s 期间，远端 docker exec 报 `OCI runtime exec failed: exec failed: unable to start container process`，**整个容器死了**，SSH `Connection refused`，用户被迫重新申请容器。
- **根因**：`cudnn.deterministic=True` + `CUBLAS_WORKSPACE_CONFIG=:4096:8` 强制 PyTorch 走 deterministic 算法。HunyuanImage3 DiT 用了 Conv3d / 某些 attention kernel 在 cuDNN 9 / CUDA 13 下**没有 deterministic 实现**，runtime 抛 CUDA error → worker 进程崩 → 容器 OOM 或 segfault → 整个 docker 死。
- **解法**：调试性"flip stability knobs"必须**分级单步**翻，每加一个就跑一次 sanity check：
  - L1（最不侵入）：只 `cudnn.allow_tf32=False` + `cuda.matmul.allow_tf32=False` —— 关 TF32 走 FP32，几乎不会 crash，只是慢一点
  - L2：+ `cudnn.benchmark=False` —— 关 autotuning，picks 默认 kernel
  - L3：+ `set_float32_matmul_precision('highest')` —— 等价 L1 但用新 API
  - **永远不加** `cudnn.deterministic=True` 和 `CUBLAS_WORKSPACE_CONFIG=:N:N`，除非确认每个 op 都有 deterministic 实现
- 每个旋钮 init 用 `try/except` 包裹，失败不影响后续 import。
- **对未来的提醒**：
  - "为快速 disambiguate 一锅端"看似省时，实际只要其中一个 flag 引发 runtime error 就连带把所有其他 flag 的实验数据废掉，反而最慢
  - 对硬件级旋钮（cuDNN/CUBLAS/NCCL）下手前先 grep 是否有 known-failure 的 op：HunyuanImage3 用 Conv3d，cuDNN 9 deterministic Conv3d 实现长期 buggy，是 known landmine
  - 容器死掉的代价高（用户重申请、所有 /tmp 数据丢失），比"实验慢"严重得多
