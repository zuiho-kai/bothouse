---
name: rules-system-runtime-2
description: Diffusion paged cache 与系统运行时规则（2/2）DIFF-4i、4o、4p、4t、4u、4ac、4aa、4ab、4ad：DiffusionModelMetadata 经 architecture→pipeline 解析、AR-Diffusion resident capacity 预算、Scheduler-managed Diffusion KV 原子分配与请求生命周期、HiDream-O1 checkpoint signature、Worker 物理 paged KV 原子安装、cache_backend 显式 None 规范成 none、AR-Diffusion K/V 分存储、stepwise 单 request rollout、dummy_run_num_frames=0 退出文本 warmup
metadata:
  scope: 只收 DIFF-4i、4o、4p、4t、4u、4ac、4aa、4ab、4ad；DIFF-4a 至 DIFF-4h 见 rules-system-runtime-1，paged KV 控制面的 DIFFKV 规则归 paged-kv-control-plane
---
# Diffusion paged cache 与系统运行时规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-system-runtime.md` 的第 2/2 部分；第 1 部分 [[rules-system-runtime-1]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-system-runtime.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-03；updated: 2026-09-22
- [DIFF-4i] 模型能力 metadata 必须跨 architecture 与 pipeline 两个 key space 解析
  - 触发：修改 diffusion registry、HF `architectures`、`model_class_name` 或共享 `DiffusionModelMetadata`，尤其是多图数量、mixed-reference 与 attention-mask-free 能力。
  - 强制：先接受 metadata 表中的 direct pipeline key；未命中时只通过 registry 的 `architecture → pipeline class` 映射解析一次，再查 metadata。unknown architecture、`None`，以及 registry 映射到没有 metadata 的 pipeline 都保持空 defaults；registry tuple 用解包读取，使布局变化显式失败。
    - 此 helper 返回整份 metadata，影响 config、AsyncOmni serving view、视频 mixed reference 和 attention backend，不得把修改只当作 image-count 局部修复。
  - 验收：同时覆盖 direct pipeline key、architecture→metadata-bearing pipeline、unknown/`None`、以及 architecture→无 metadata pipeline；通过 `OmniDiffusionConfig.update_multimodal_support()` 断言整份能力传播，并在 serving 边界验证 false→1、true+整数上限与无上限行为。PR #5838 只新增 Qwen direct 与 Hunyuan architecture→pipeline 的手动 config 测试；
    - 未执行真实 architecture 解析、AsyncOmni 或 HTTP edit 路径，也没有 registry/metadata census 和 negative alias 回归。其 E2E 结果只有截图，缺命令文本日志、vLLM 版本、upstream SHA 与重复次数。helper 仍 function-local import 私有 `_DIFFUSION_MODELS`，review 提议公开改名但 final 未采用。^[PR #5838]
- 相关执行流见 [[diffusion-architecture]]（Diffusion architecture）；paged attention 的 layout 细节见 [[rules-attention-1]]、[[rules-attention-2]]、[[rules-attention-3]]（attention 规则）。
- [DIFF-4o] AR-Diffusion 容量必须覆盖持久状态，分页图输入必须显式
  - 触发：AR-Diffusion runner 修改 paged self-attention KV、resident session capacity、scratch/cross-attention reservation、model-owned CUDA state、commit pruning 或 CUDA Graph 输入。
  - 强制：按有效 resident capacity 完整计算 `sink + recent window`、单个 in-flight block、scratch、cross-attention 和每 session 的 model-owned state；`gpu_memory_fraction` 只能控制额外 residency，至少一个能装入实际空闲显存的 session 必须先被接纳，并在分配 self-KV 前扣除所有持久 reservation。成功 commit 后立即释放 skipped paged blocks；
    - paged attention 将可变 key/value pool 作为显式可变 graph input。worker-local state 仍须保持 `max_num_seqs=1`，多副本必须先具备 session affinity。
  - 验收：覆盖 LingBot 两个 resident window、DreamZero 声明 capacity 64 的预算封顶、LRU eviction、失败 forward 清理、commit 后 block 回收和显式 graph pool 输入；真实 TP 还要用统一的 min free-memory/all-reduce 或 rank-0 广播验证所有 rank 得到相同 capacity，并分别验证 paged/direct 数值与单副本路由。^[PR #5491]
- [DIFF-4p] Scheduler-managed Diffusion KV 必须原子分配并绑定请求生命周期
  - 触发：启用 `paged_scheduler`，或修改 Worker KV geometry discovery、显存 profile、Scheduler admission、CFG allocation、`NewRequestData`/DLO RPC envelope 和 request terminal cleanup。
  - 强制：模型加载后从每个 Worker 的 cache-enabled attention 生成 rank-local native `FullAttentionSpec`，以最大 per-rank profile batch 测量 KV headroom，再通过 `get_kv_cache_configs()`、`generate_scheduler_kv_cache_config()` 和 `resolve_kv_cache_block_sizes()` 构造 Worker/Scheduler 配置。
    - Scheduler 是 logical allocation/generation owner，Worker 是 physical tensors/BlockTables/slot mappings owner；每个 CFG sequence 按完整首步 `seq_len` 以 `full_sequence_must_fit=True` 分配，先按空池所需 block 总数做 never-fit 检查，并在所有 sequence 成功前保持原子性。
    - 生成的 `DiffusionKVMetadata` 必须与请求绑定并随完整 `NewRequestData` envelope 传到 Worker；完成、取消、错误、pop 和 close 都必须释放整组 allocation，preemption 只保留既有 allocation。^[PR #6563]
  - 验收：覆盖 dense 默认旁路、rank/spec/memory mismatch、profile 顺序、CFG partial rollback、临时压力返回 `None` 后 FIFO 重试、空池也放不下时只终止该请求、native allocation error、preemption metadata 保留，以及 finish/cancel/error/pop/close 全部释放；Hunyuan first prefill 覆盖整 allocation，denoise 只写 prefix-offset target。^[PR #6094] ^[PR #6563]
- [DIFF-4t] HiDream-O1 checkpoint signature 必须正向门禁
  - 触发：diffusion registry、`resolve_model_class_name()`、`OmniDiffusionConfig` enrichment 或 HF checkpoint 自动识别逻辑需要区分 HiDream-O1 与普通 Qwen3-VL。
  - 强制：仅当 `config.json` 的 `model_type` 为 `qwen3_vl`，且 `model.safetensors.index.json` 的原始 `weight_map` 含 `model.final_layer2.linear.weight` 或 `final_layer2.linear.weight` 时，才返回 `HiDreamO1ImagePipeline`；
    - `resolve_model_class_name()` 与 config enrichment 必须复用同一正向 signature，registry 同时登记 pipeline 与 post-process。
  - 验收：覆盖 HiDream signature 命中、普通 Qwen3-VL、缺失/错误 `weight_map`、显式类名与 signature 不一致，以及 resolver/enrichment 两条路径；再断言 registry pipeline 和 module-level post-process 均可解析。^[PR #5194]
- [DIFF-4u] Worker 物理 paged KV 必须与 Scheduler 逻辑分配分层并原子安装
  - 触发：启用或修改 diffusion Worker 的 native paged KV data plane、请求 row registry、paged attention adapter、BlockTables 更新或唤醒/终止清理。
  - 强制：Scheduler 只拥有 logical block allocation、generation 和 `DiffusionKVMetadata`；每个 Worker rank 消费自己的 `KVCacheConfig`，拥有物理 KV tensors、native `BlockTables` 和 request/sequence/context rows。安装 metadata 前必须校验 group/count/range/capacity，并以 staged append、apply 和失败 rollback 原子发布；
    - 重复 generation 幂等，冲突或过期快照拒绝，BlockTables 变更使已准备的 attention batch 失效，终止时先清 Worker rows 而不释放 Scheduler blocks。request-mode runner 负责从 snapshot 构造并激活 prefill/denoise row metadata；model 只提供 Q/K/V layout 与 `full_attn_spans`。
  - 验收：CPU/mock 覆盖 rank-local config、请求/上下文 row mapping、重复/过期/冲突 generation、非法 block 与容量、append/apply rollback、幂等清理和 wake refresh；GPU/NPU 另验证非连续 BlockTables、32Q/8KV GQA、异构 prefix 与 piecewise attention。
    - Hunyuan paged request execution 不证明 `denoise_step`、cross-request prefix reuse、AR KV、negative CFG、Ring 或 AllGather。^[PR #6102] ^[PR #6563]
- [DIFF-4ac] 声明为 str 的 diffusion cache_backend 必须在 kwargs 边界把显式 None 规范成 none
  - 触发：修改 `normalize_omni_diffusion_kwargs`、`OmniDiffusionConfig.cache_backend`，或 pipeline/runner 对 cache backend 的 admission 校验。
  - 强制：字段声明为 `str` 且 canonical “无 cache” sentinel 为 `"none"` 时，key 缺失才允许走 env/`"none"` 默认；调用方传入显式 `None`（如 CLI `default=None`）必须在 kwargs 边界规范成 `"none"`，且不得回落到 `DIFFUSION_CACHE_BACKEND` 查找。下游校验可把残留 `None` 当 `"none"` 作 defense-in-depth，但不能代替边界规范化。
  - 验收：`from_kwargs`/`create_default_diffusion` 对 `cache_backend=None` 断言最终为 `"none"`；至少一个严格 `("none", …)` 校验路径覆盖 `None` 与 `"none"` 均可通过，未知 backend 仍拒绝。^[PR #7041]
- [DIFF-4aa] AR-Diffusion paged K/V 必须分存储分配，禁止共享 `(2, …)` 视图
  - 触发：修改 AR-Diffusion `allocate_kv_pool_with_views`、paged-write custom op 的 `mutates_args`、compiled graph 下的 key/value pool，或把 K/V 重新合并为单一 allocation。
  - 强制：每层 K 与 V 各自 `torch.empty` 独立 storage，布局仍为 `(num_blocks, block_size, num_kv_heads, head_dim)`；`kv_pools[layer][0]/[1]` 与 flat slot view 继续寻址，但不共享 `untyped_storage`。paged-write 若同时 mutate K 与 V，共享 storage 会让 Inductor reinplace 只重写第一个参数，并使 `auto_functionalized_v2` 克隆整份 V pool。
  - 验收：断言各层 K/V `data_ptr` 不同且写 V 不扰动 K；编译生成代码不得出现 pool-sized clone；有界硬件证明 compiled 路径可运行且无 per-step 整池拷贝。^[PR #6463]
- [DIFF-4ab] AR-Diffusion stepwise 必须以一次 request 驱动整段 rollout
  - 触发：修改 `SupportsStepExecution`、`ARDiffusionModelRunner` 的 stepwise 绑定、AR block/`post_decode` chunk 提交、`step_execution`+`streaming_output` deploy，或把外部 tick 循环重新当作 session 边界。
  - 强制：一次 `generate()` 驱动整段 rollout：`prepare_encode` 只跑一次，随后多轮 `denoise_step`/`step_scheduler`，由 `post_decode` 产出每个 AR chunk。request-mode 与 stepwise 必须共用同一份 block/DMD math，禁止维护两套可漂移实现。runner 仅为实现该合同的 pipeline 打开 `step_execution`；绑定 runner-owned KV 时 `session_id == request_id`；
    - 错误路径 fail-closed 释放 session，完成或 scheduler abort 时退役。持有 AR-Diffusion paged KV 的 stage 必须保持 `max_num_seqs=1`。
  - 验收：覆盖 stepwise 与 request-mode 的共享 math 边界、session bind/release、abort/completion 退役，以及 `max_num_seqs=1` 拓扑；request-scoped camera script 等模型字段另由模型 owner 验收，不得外推为通用 mid-request interaction。^[PR #6844]
- [DIFF-4ad] 无法合成观测的 pipeline 必须退出通用文本 warmup
  - 触发：修改 `DiffusionEngine.run_startup_warmup`、`dummy_run_num_frames`，或新增必须携带非文本观测（如 `robot_obs`）的 diffusion pipeline。
  - 强制：通用 startup warmup 是文本、两步请求。pipeline 无法从该请求合成所需观测时，必须声明 `dummy_run_num_frames: ClassVar[int] = 0`，使 `run_startup_warmup` 不提交请求、也不因此 `close`。模型自有 warmup（如 AR-Diffusion 的 `ar_diffusion_warmup_requests`）保持可用。能接受文本 dummy 的模型仍走两步通用 warmup。
  - 验收：经真实 registry 查找，DreamZero 与 LingBot 的 startup 不调用 `add_req_and_wait_for_response` 且不 `close`；其余模型的两步 dummy 合同不变。^[PR #7548]

## 决策与踩坑

- [DIFF-4i] 禁止：因 architecture 已注册就假定其 pipeline 有 metadata；递归猜测别名；让 direct key 被 registry 映射覆盖；或把 defaults 的 `supports_multimodal_inputs=false` 当成“数量未知”——image-edit admission 会把它解释为最多一张图，而 `supports=true, max=None` 才是不设上限。
- [DIFF-4o] 禁止：用只覆盖一个 session 的固定 floor 忽略声明 capacity；只为 self-KV 预算而漏算 cross-attention、scratch 或模型自有状态；使用 process-global KV pool registry；让各 TP rank 依据不同的本地 free-memory 计算不同 capacity 后继续 collective；把单次 TP replay 或能启动当作多 session/多 rank 预算正确性的证明。
- [DIFF-4p] 禁止：引入独立 block pool、KV spec、refcount 或 physical lifecycle；把部分 CFG 分配当作成功；把临时容量不足误报为永久失败，或让 never-fit 请求在 FIFO 头部无限阻塞；在 DLO DP wave 中拆开 request 与对应 metadata，或让 scheduler/busy-loop 异常逃逸而不唤醒请求流。
- [DIFF-4t] 禁止：把任意 `qwen3_vl` 配置归类为 HiDream-O1；给 raw index key 强加 `model.` 前缀；只增加显式 `model_class_name` 映射而让通用 text-to-image/server 自动解析仍落到未注册 architecture；缺失或格式异常的 index 不得误报命中。
- [DIFF-4u] 禁止：Worker 自行分配或释放 Scheduler-owned logical blocks；把部分 row 安装、native append/apply 异常或 stale snapshot 当作成功；从 padding 猜异构 prefix 的逻辑布局；在清理或 wake refresh 后继续复用旧的 native metadata/buffer view。
- [DIFF-4ac] 禁止：只在 key 缺失时默认、让显式 `None` 泄漏成 typed `str` 字段上的 `None`；把 `"none"` 与 env 覆盖混为一谈；把某一 pipeline 的 `None` 特判当成唯一修复点。
- [DIFF-4aa] 禁止：恢复 `empty(2, num_blocks, …)` 再 `kv[0]`/`kv[1]` 切片；或把“eager 能跑”当成 compiled 路径无整池拷贝的证明。
- [DIFF-4ab] 禁止：用多次 `generate()`/tick 冒充同一 session；在 denoise step 内提交本应属于 `post_decode` 的 clean-x0 KV commit；或把逐步 camera/prompt mid-request interaction 写成已由本合同覆盖。
- [DIFF-4ad] 禁止：把 DreamZero/LingBot 的 opt-out 扩成所有模型跳过 warmup；用一步 shortcut 让非法文本请求穿过观测检查；opt-out 后仍断言 engine 被关闭。
