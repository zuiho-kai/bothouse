---
name: paged-kv-control-plane
description: "Diffusion paged KV 请求控制面规则 DIFFKV-1a、1b、2a、2b、2c：diffusion_kv_mode 显式选择与 fail fast、admission lock 前恰好一次预处理与 prepared_layout、Scheduler 持有 DiffusionKVRequest 的 prefix/target/suffix 长度、空 block_hashes 只做 request-local paging、Worker 只收 allocation snapshot；HunyuanImage3 证据边界（PR #5541、#5550、#6563）"
metadata:
  scope: 只收 Scheduler-managed diffusion KV 的请求控制面合同（DIFFKV-*）与其证据边界；paged_scheduler 的 KV sizing 配置字段（CONF-2b、CONF-2c）归 configuration-rules-2，AR-Diffusion kernel 的 page 几何归 rules-ar-paging-geometry
---
# Diffusion paged KV control plane

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/paged-kv-control-plane.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion, scheduler；created: 2026-09-02；updated: 2026-09-05
- 来源（sources）：PR #5541；PR #5550；PR #6563；vllm_omni/config/omni_config.py；vllm_omni/diffusion/data.py；vllm_omni/diffusion/diffusion_engine.py；vllm_omni/diffusion/diffusion_kv/；vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py
  - vllm_omni/diffusion/models/hunyuan_image3/request_layout.py；vllm_omni/diffusion/request.py；vllm_omni/diffusion/sched/；vllm_omni/diffusion/worker/diffusion_model_runner.py；vllm_omni/diffusion/worker/diffusion_worker.py；tests/diffusion/diffusion_kv/
  - tests/diffusion/models/hunyuan_image3/test_hunyuan_image3_step_execution.py；tests/diffusion/test_diffusion_model_runner.py
- 只有 `DIFFKV-数字字母` 是可审计规则 ID。本页描述目标 pin 的**请求控制面合同**；它没有实现物理 KV cache、block table、slot mapping、paged attention 或跨请求命中。
- [DIFFKV-1a] mode 必须显式选择，未实现模式 fail fast
  - 触发：增加或修改 `diffusion_kv_mode`、structured/runtime config 投影、KV receive intent 或 legacy dense KV 字段。
  - 强制：`dense_legacy` 保持默认和原行为，只有 `paged_scheduler` 启用预处理与 Scheduler 所有权；`omni_kv_config` 是独立 transport 配置，不是 mode 别名。`paged_scheduler` 必须在初始化拒绝 `need_recv_cache=True`，但仅携带 `kv_sender_info` 不能当成导入意图。
  - 验收：走完整 `VllmOmniConfig.from_pipeline_config()` 与 runtime config 路径，分别覆盖默认、paged、unknown、worker-local、receive=true 和 sender-metadata-only，不能只测 enum parser。^[PR #5541]
- [DIFFKV-1b] 预处理恰好一次，并在 admission lock 之前完成
  - 触发：修改 Engine admission 入口、模型 preprocessor、`prepared_layout` 或 Worker step-state 初始化。
  - 强制：streaming、`add_request`、async/sync wait 与 dummy warmup 都只调用一次 `_prepare_request_for_admission`，再把 prepared request 送入内部 admission；模型预处理必须在 Engine condition/RPC lock 之前完成。`prepared_layout` 随 Worker payload 进入 step state；
    - 泛型字段实际是 `Any | None`，Hunyuan consumer 必须用 `get_hunyuan_prepared_layout` 校验具体类型。
  - 验收：所有入口断言 exactly once；prepared/local A/B 覆盖 CFG=1/2、含/不含 reference image，比较 tokens、RoPE、mask、scatter index 和 step update。reference-image case 只证明规划等价；Worker `prepare_encode()` 调用 helper 时仍设 `allow_cond_image=False` 并拒绝非 dummy image-edit，不能宣称 paged image editing 已可执行。^[PR #5541]
- [DIFFKV-2a] Scheduler 持有逻辑请求，Worker 不得收到可变管理状态
  - 触发：修改逻辑 KV length、CFG row mapping、context 表达、Scheduler admission 或 Worker payload。
  - 强制：每个 CFG row 建一个 Scheduler-owned `DiffusionKVRequest`；主序列是 `[prefix | target | suffix]`，`prefix_len` 可复用，`target_len` 每步重写，`seq_len` 是首步完整 allocation boundary，并允许 `prefix_len + target_len < seq_len`。
    - Hunyuan 分别从 `gen_timestep_scatter_index[row,-1]`、生成图+timestep/guidance token 和 `real_pos[row,-1]` 取得三段长度；prompt/reference image 已在同一 self-attention sequence，所以 `kv_contexts=()`。Scheduler 只持有 logical allocation/generation；
    - Worker 才持有 physical KV tensors、native BlockTables、slot mapping 与 attention metadata。first prefill 的 query/sequence span 必须覆盖整个 logical allocation；后续 denoise 仅以 `prefix_len` 为 `kv_start_pos` 写入 target span。
  - 验收：CFG=1/2、suffix、reference image 与独立 context 都验证 identity/length/owner。失败路径也要原子：目标 `_make_request_state` 在 `_build_sampling_params_key` 前清空原 request，后者抛错时会丢失 tuple；修复前必须保留 retry gap，修复时增加失败后重试测试或延后 destructive move。^[PR #5541]
- [DIFFKV-2b] 空 hash 只允许 request-local paging，禁止发布 prefix
  - 触发：增加 block hashes、native `KVCacheManager` 调用、physical cache spec/config 或 prefix 发布。
  - 强制：Hunyuan 当前保持 `block_hashes=[]` 与 `skip_reading_prefix_cache=True`，只允许请求内 page allocation；只有模型预处理为每个可缓存完整 block 生成 canonical hash 后，才可条件调用 `cache_blocks(request, prefix_len)`。物理 geometry 必须以后续 Worker 已加载 attention module 暴露的 native `KVCacheSpec` 为真源，再经 Engine 配置和 Worker 初始化。
  - 验收：空 hash case 分配后不发布；完整测试 hash 的 delayed commit 只发布 prefix、不发布 target；native manager facade test 不得冒充 Scheduler allocation、BlockTable、slot mapping、paged attention 或跨请求正确性。^[PR #5541]
- [DIFFKV-2c] Worker 只接收请求级 allocation snapshot，不接收 Scheduler 可变状态
  - 触发：增加 `DiffusionKVMetadata`、`NewRequestData` 字段，或修改 request/batch/step 的 Scheduler→Executor→Worker→ModelRunner RPC。snapshot 在 request scope 保存 generation、sequence 的 prefix/target/full length、可引用的独立 context，以及每个 native cache group 的 block ID；多个 CFG sequence 可引用同一个 context，也可引用各自 context。
  - 强制：metadata 与已初始化 request 原子放在同一个 new-request envelope，且 envelope ID、实际转发的 `req.request_id`、metadata ID 在任何 model work/RPC 前一致。request mode 只在 metadata 存在时追加第四个 RPC 位置参数，保持 dense 历史三参数 shape；batch/step 则随完整 `DiffusionSchedulerOutput` 传输。
    - `prepared_layout` 仍是独立的 model-owned payload，不能从它派生 block ID。Worker wrapper 也只在非空时向旧 runner 增加 keyword，避免破坏 dense/custom runner。
  - 强制：`paged_scheduler` 的 request envelope 必须携带并消费 metadata，Worker 安装 physical cache/BlockTables/slot mapping 后才能激活 paged attention；`dense_legacy` 必须拒绝 metadata。带 metadata 的多请求 wave 不能走没有逐请求 snapshot 参数的 DLO list-request 快捷 RPC。^[PR #5550] ^[PR #6563]
  - 验收：request/batch/step 覆盖 metadata 缺省、传播与三方 ID mismatch；dense metadata fail-fast，DLO metadata wave 不进入 list-request 分支，legacy positional shape 与 `prepared_layout` identity 保持；
    - installer 覆盖 invalid group/count/range/capacity、duplicate identity、stale/conflicting generation、idempotent replay，以及 append/apply failure rollback。^[PR #6563]

### 证据边界

- HunyuanImage3 现已在 NVIDIA GPU 与 Ascend NPU 的 `request_execution` 路径消费 Scheduler-paged metadata；它不证明 `denoise_step`、continuous batching/多请求 admission、导入 AR-to-DiT KV、Ring SP、AllGather-KV 或跨请求 prefix reuse。空 hash 仍意味着 request-local allocation，而非 prefix hit。^[PR #6563]

## 决策与踩坑

- [DIFFKV-1a] 禁止：让预留的 `paged_worker_local` 静默退回 dense；在 paged mode 接受 request/sampling 上非空 `past_key_values` 或任何 `*_past_key_values`。dense mode 仍保留旧字段兼容。
- [DIFFKV-1b] 禁止：某入口漏做或重复 chat template；把 Scheduler-owned KV request 或物理 block ID 放进 prepared layout。Hunyuan layout 只承载 tokenizer tokens、image geometry、RoPE/positions、masks 与 scatter indices。
- [DIFFKV-2a] 禁止：把独立 cross/joint context 塞入主 token axis，或把可变 `DiffusionKVRequest` 送给 Worker；admission 必须把 tuple 移入 `SchedulerRequestState` 并清空 Worker-bound 字段。
- [DIFFKV-2b] 禁止：空 hash 无条件发布 prefix，或从静态 HF config 复制 TP heads、dtype、PP layer ownership、cache sharing 和 backend tensor layout；当前合同没有跨 request/CFG semantic hit。
- [DIFFKV-2c] 禁止：把这些可变 dataclass 本身当成安全边界。Worker installer 必须对照 rank-local native `KVCacheConfig` 与 generation registry，验证非空 request、non-negative generation/sequence ID、唯一 sequence/context identity、cache-group 数、按 token length 推导的 block 数、row capacity 和 block ID type/range；
  - stale/conflicting generation 必须拒绝，重复同 snapshot/generation 幂等。`prefix+target<=seq_len` 与 sequence 引用的 context 集合仍由 Scheduler producer/model layout owner 保证，不能从 DTO 自证。
