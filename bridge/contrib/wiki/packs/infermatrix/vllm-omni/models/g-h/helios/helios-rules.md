---
name: helios-rules
description: "Helios cross-attention cache 规则 HELIOS-CACHE-1a：SourceTensorLRUCache 的 data_ptr 等指纹旁必须保存 source tensor weakref，dead ref 命中算 miss，LRU 有界，显式清缓存同时清 projection 与 KV（PR #8064）"
metadata:
  scope: 只收 HELIOS-CACHE-1a 一条规则及其代码入口表；Helios 的模型结构归 helios-overview，各模型共用的请求 cache 边界归 cache-acceleration
---
# Helios cross-attention cache 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/helios/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8064
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| cross-attention KV、text projection、source weakref、LRU、clear | `HELIOS-CACHE-1a` | `vllm_omni/diffusion/models/helios/cross_attn_cache.py::SourceTensorLRUCache` → `vllm_omni/diffusion/models/helios/helios_transformer.py::HeliosTransformer3DModel` |

### [HELIOS-CACHE-1a] source tensor 指纹必须有 liveness，不能以地址等同跨请求内容

- 触发：修改 Helios text projection / cross-attention KV cache 的 key、LRU 或生命周期。
- 强制：data_ptr/shape/stride/dtype/device/version 指纹旁保存 source tensor weakref；lookup 检查原 source 仍存活，dead ref 命中也必须 miss 并清除，insert 主动清 dead entries，LRU 有界。request 持有 source 时允许 intra-request denoise reuse；显式清缓存同时清 projection 与 KV 两套。inference tensor 没 version counter 时保持安全路径。
- 验收：持有 source 时 hit、GC 后相同伪指纹 miss、version/shape/stride 改变 miss、LRU eviction 与两套 clear；连续不同 prompt GPU 请求另验证条件不会交叉污染。^[PR #8064]
- 共用请求 cache 边界查 [[cache-acceleration]]（Diffusion cache）；模型结构查 [[helios-overview]]（Helios index）。

## 决策与踩坑

- [HELIOS-CACHE-1a] 禁止：地址重用时让新 prompt 命中旧 KV；缓存强引用把 source 永久钉住；把没有 version counter 当成可检测任意原地修改（inference tensor mutation 仍需请求级边界）。
