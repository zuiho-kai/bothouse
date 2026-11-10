---
name: session-state
description: "实验性 world-model session-state manager：只管 request/session 生命周期、LRU 表与存储统计，max_sessions 不是 OOM 上界，byte_budget 只记录不执行；Cosmos3 接入是 request 内临时缓存（COSMOS-2c），PR #4657 只有 CPU adapter 与 mocked pipeline 证据"
metadata:
  scope: 只收 vllm_omni/experimental/world_models/session_state/ 的生命周期、内存统计边界与 Cosmos3 接入证据；diffusion cache 后端归 cache-acceleration，paged KV 控制面归 paged-kv-control-plane
---
# World-model session state

## 现状

- 实验性 session-state manager 只负责 request/session 生命周期、LRU 表和存储统计；具体 state 的形状、键和装卸语义由 model adapter 拥有。不要把 Cosmos3 的 dense UND encode-once K/V 与 [[dreamzero-architecture]]（DreamZero） 的 paged AR-diffusion KV 抽象成同一缓存合同。

### 生命周期与内存边界

- session ID 选择 manager entry；何时 reset/drop、是否跨 request 保留由 model adapter 与 pipeline 定义，不能从 manager 本身推断 session 的持久性。
- `max_sessions` 是 entry 数量 LRU：淘汰只移除 manager lookup，活动 adapter 或 transformer alias 仍可保留对象和底层 storage，因此它不是 OOM 上界。
- `byte_budget` 当前只记录、不执行。stats 按 device 对物理 storage 去重，但 manager 外的 alias（例如 drop 后 transformer 最后加载的 K/V）不会计入，可能低报进程实际驻留。
- adapter 隔离了已存 state，却没有让共享 mutable pipeline 并发安全；transformer 的 load→forward handoff 仍是可变状态区间。

### Cosmos3 接入与证据

- Cosmos3 在每次 generation 开始 reset，并让整个 denoise dispatch 经 `finally` drop；因此该接入是 request 内临时缓存，不是跨请求记忆。其 branch/layer key、RoPE 恢复、CFG 形态和 fail-closed 条件见 [[cosmos3-rules-1]]（COSMOS-2c；源锚点 #cosmos-2c-session-manager-缓存必须按-branchlayer-完整装卸）。功能默认关闭，保留原 transformer-instance cache。
  - PR #4657 的 CPU adapter 与 mocked pipeline 测试覆盖生命周期和路由，但没有真实 GPU/model 的 flag-on 集成、当前 head equivalence 或 peak-memory A/B；早期 `MAX_ABS_DIFF=0` 使用了错误环境变量，不能作为证据。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/session-state.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-09-04
- 来源（sources）：PR #4657；docs/features/session_state_manager.md；vllm_omni/experimental/world_models/session_state/；vllm_omni/experimental/world_models/adapters/state_cosmos3_adapter.py；tests/diffusion/models/cosmos3/test_session_memory_equivalence.py
  - tests/diffusion/models/cosmos3/test_cosmos3_pipeline.py
- 置信度（confidence）：high
