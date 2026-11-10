---
name: rules-wan-spatial-shard
description: "Wan VAE spatial-shard 规则 DIFF-3b、DIFF-3c：reshard 用 group 相对 rank、`start=min(rank*local_extent, actual_extent)`，尾部补零成固定 local shape，attention 输出须保持 trimmed extent（PR #6062）；DistributedVaeExecutor 通信使用 get_world_group().device_group，双 GPU 对照容差 0.03（PR #6401）"
metadata:
  scope: 只收 wan_spatial_shard.py 的 trim/reshard 边界数学与 distributed VAE 的 process group 选择；Wan VAE fastpath 数值预算（DIFF-3d、3e）归 rules-wan-fastpath，batch VAE decode 归 rules-vae-batch
---
# Wan VAE spatial-shard 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-wan-spatial-shard.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-09-04
- 来源（sources）：PR #6062；vllm_omni/diffusion/distributed/autoencoders/wan_spatial_shard.py；tests/diffusion/distributed/test_wan_spatial_shard.py；PR #6401
- 置信度（confidence）：high
- [DIFF-3b] trimmed global extent 必须可逆地 reshard 为固定 local shape
  - 触发：修改 Wan VAE spatial-shard height/width split、gather/trim/reshard、attention wrapper、padding 或保存的 `SpatialShardContext`。
  - 强制：reshard 使用 process group 的相对 rank，并在存在 context 时先验证它与 context rank 一致；不一致必须在 slicing 前 fail-fast。设 `actual_extent=x.shape[dim]`，则 `start=min(rank*local_extent, actual_extent)`，valid extent 同时受 context 推导的有效长度和 `actual_extent-start` 约束。`narrow` 后不足 `local_extent` 的尾部补零，使每 rank shape 相同；
    - 空 trailing shard 必须成为合法的 zero-length slice + full zero padding，而不是越界 offset。
  - attention wrapper 在 global gather 后把目标 extent clamp 到实际 gathered extent；attention 输出在 split axis 上必须保持这个 trimmed extent，否则报告 group rank、split axis、local/gathered/trimmed/output extent 和 context 后失败，禁止把改变后的 extent 继续按旧边界 reshard。
  - 验收：height/width 都覆盖 world size 大于 extent 的 empty tail、不能整除的 partial tail 和常规 extent；拼接所有固定 local shards 并 trim 后必须逐值重建输入。另覆盖 context/group rank mismatch 与 attention shrink/expand。CPU slicing tests 只证明边界数学；
    - collective/halo correctness 仍需多 GPU height/width 对 single-process reference，生产 pipeline smoke 另验证真实 VAE patch/caller。^[PR #6062]
- [DIFF-3c] distributed VAE 通信必须使用专用 WORLD device group
  - 触发：修改 `DistributedVaeExecutor`、Wan VAE spatial-shard 的 collective/halo 通信或其 process group 选择。
  - 强制：分布式 VAE 通信必须使用 `get_world_group().device_group` 这一覆盖完整 worker WORLD 的专用 device process group，并通过该 group 获取 `world_size` 与 `rank`；不得使用默认 `group=None`。该组必须与 Wan spatial-shard 交错执行的 halo P2P/collective 通信隔离，避免共享默认 communicator 破坏 shard-boundary 数据。
  - 验收：mock/CPU 单测断言 `executor.group is get_world_group().device_group`，并覆盖通过该 group 查询 rank/world size；双 GPU 分别运行 height/width spatial-shard decode，与单进程 reference 对照并满足既有 `0.03` 最大差异容差。^[PR #6401]

## 决策与踩坑

- [DIFF-3b] 禁止：仅把 valid length clamp 为零却保留越界 start；让最后一 rank 返回短 tensor；混用 global rank 与 group-relative rank；假设 attention 永远 shape-preserving 而无 guard；只测 height 后外推 width。
- [DIFF-3c] 禁止：让 VAE tile collectives 或 P2P 复用默认 WORLD communicator；只凭单测中的 group 对象检查或 world_size=1 运行宣称 spatial-shard 已完成数值正确性验证。
