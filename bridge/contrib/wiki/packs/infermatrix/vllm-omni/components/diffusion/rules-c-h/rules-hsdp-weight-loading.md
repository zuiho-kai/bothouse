---
name: rules-hsdp-weight-loading
description: "Diffusion 规则 DIFF-HSDP-LOAD-1a：hsdp_weight_load_strategy 的 pre_sharded 路径先校验 checkpoint binding（sources、key/shape、layout、dtype），对 meta 参数真实 HSDP 分片后只读本 rank 的 safetensors slice；两 rank Cosmos3/Edge 与 full-load 对齐（PR #7948）"
metadata:
  scope: 只收 HSDP pre-sharded 权重加载策略这一条规则；HSDP/FSDP fully_shard 验证（DIFF-2b）归 rules-checkpoint-loading-1，online FP8 的 HSDP 识别（DIFF-2p）归 rules-checkpoint-loading-2
---
# HSDP pre-sharded 权重加载规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-hsdp-weight-loading.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7948
- 置信度（confidence）：high
- [DIFF-HSDP-LOAD-1a] pre-sharded 路径须先验证 binding，再分片并读取本 rank 权重
  - 触发：修改 `hsdp_weight_load_strategy`、meta-first HSDP loader、checkpoint binding 或模型的增量 meta 初始化。
  - 强制：`full` 保持默认，`pre_sharded` 只进入支持该契约的 default diffusion loader；在权重 I/O 前检查完整的专用 transformer sources、key/shape、runtime layout 与 dtype 一致性。先对 meta 参数执行真实 HSDP 分片，再 materialize FSDP-owned local storage 和读取 safetensors 的 rank-local slices；
    - 保留 nonpersistent buffer、非 HSDP encoder/VAE 加载及 post-load hooks，并拒绝遗留 meta tensor。
  - 验收：覆盖不完整 sources、layout/dtype mismatch、unsupported combination 和剩余 meta 的拒绝；真实两 rank Cosmos3/Edge 与 full-load 结果对齐，测试 marker 必须命中对应 CUDA 两卡 lane，不能以 CPU binding 测试替代该 parity。^[PR #7948]

## 决策与踩坑

- [DIFF-HSDP-LOAD-1a] 禁止：接受 quantization、LoRA、需要 transform 的 binding 或隐式 dtype 转换；在未适配模型上先加载整份参数再声称 pre-sharded；把一个 Cosmos checkpoint 的 host-memory 结果推广到所有模型/拓扑。
