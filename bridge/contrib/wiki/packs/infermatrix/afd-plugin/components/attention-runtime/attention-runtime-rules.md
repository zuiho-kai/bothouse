---
name: attention-runtime-rules
description: afd_plugin/v1/worker 审查规则 AFD-I34…AFD-I43 及 GPU MRV2 两条，覆盖 AFD 事务元数据安装顺序、runner 字段初始化、connector 生命周期、符号替换作用域、FULL replay hook、stage metadata、NPU Async CAM
metadata:
  scope: 只收 afd_plugin/v1/worker 的审查规则（AFD 事务元数据、控制面发送、runner 生命周期，含 v0.30 GPU MRV2 的 prepare seam 与 stage metadata）；运行流程归 attention-runtime-architecture，patch 门禁归 compatibility-rules
---
# afd_plugin/v1/worker 审查规则：AFD 事务元数据、控制面发送与 runner 生命周期

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/attention-runtime/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin；created: 2026-09-30；updated: 2026-10-09
- 来源：
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:afd_plugin/v1/worker/attention_model_runner_v2.py
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:afd_plugin/v1/worker/attention_metadata.py
  - afd-plugin@4c98691501be37f21735725f7429715ae98b603b:tests/unit/v1/worker/test_model_runner_v2.py

- [AFD-I34] `install_afd_metadata_on_forward_context` 只在 pending 为空时新建事务，顺序和子 context 判定不能改
  - 方法内顺序固定为：ubatch 子 context 直接返回（不发送）→ `_afd_pending_metadata is None` 时才 `build_afd_metadata` → 写入 `additional_kwargs["afd_metadata"]` → 检查 `_afd_suppress_metadata_send` → 发送。
  - 调换顺序后，子 context 会重复发送，或者在 suppress 作用域里照样发送。
  - 非 None 的 pending 会被原样复用，包括它的 `transaction_id` 和 `tokens_lens`。
  - 现有入口各自保证 pending 是新的：V1 靠 `_build_attention_metadata` 每步重新 stage；capture 的 ubatch 分支显式置 None；V2 靠 `_use_afd_execution_context` 在退出时恢复原值。
  - 新增前向入口要确认不会复用上一步留下的旧 metadata。
  - `_is_ubatch_child_afd_context` 的判定条件是：`ubatch_slices is None`、`num_stages > 1`、`len(tokens_lens) == 1`。
  - 它依赖两件事：父 metadata 满足 `len(tokens_lens) == num_stages`（`build_afd_metadata` 多 stage 分支），子 metadata 只有一个 `tokens_lens` 元素且保留父 `num_stages`。
  - 改 metadata 字段布局或 wrapper 构造子 metadata 的方式时，要同步检查这个判定。
  - FULL graph 且没有 `ubatch_slices` 时，DP 控制用 `_full_cudagraph_padded_tokens` 给出的 padded 数，不能换成真实 token 数。
- [AFD-I36] V1/V2/NPU runner 必须初始化同一组 AFD 字段；NPU 直接依赖 `attention_metadata.py` 的私有 helper
  - `AFDMetadataProviderMixin` 只声明字段，由子类 `__init__` 负责初始化。
  - 三个 runner 都各自设置 `_is_warmup`、`_afd_is_graph_capturing`、`_afd_is_graph_replaying`、`_afd_pending_metadata`、`_afd_suppress_metadata_send`、`_afd_transaction_counter = 0`，并要求 connector 带 `control_plane`。
  - 新增字段或新 runner 时，三处要一起改。
  - `AFDNPUAttentionModelRunner` 不继承 mixin，而是直接 import `_forward_context_num_tokens`、`_full_cudagraph_padded_tokens`、`_resolve_world_ranks`、`build_ubatch_dp_metadata_list`。
  - 改这些下划线函数的签名或语义，等于改 NPU 的接口，需要同步 `afd_plugin/v1/worker/npu/attention_model_runner.py`。
  - 每次调用 `build_afd_metadata` 都会通过 `_next_afd_transaction_id` 消耗一个事务号。不要在只需读取或检查 metadata 的地方调用它。
- [AFD-I37] connector 生命周期：rendezvous 放在 `load_model` 最后，`close()` 放在 `finally`
  - `init_afd_connector()` 是 Attention 和 FFN 之间的阻塞集合操作，同时充当“双方都加载完权重”的屏障。
  - 它必须在 `super().load_model()` 和 V1 的 `_install_afd_ubatch_wrapper()` 之后、内存 profiling 和首次前向之前执行，并保留 `is_initialized` 守卫（FFN 侧用同一个守卫）。
  - 不要把它挪回 `__init__` 或 wrapper 安装之前。
  - `shutdown` 里的 `self.connector.close()` 必须放在 `finally` 中，这样 native `super().shutdown()` 抛异常时仍会关闭。V2 还用嵌套 `finally` 保证 profiler 停止失败时不跳过后续清理。
  - V2 `__init__` 在 `super().__init__` 之后出错时，会关闭已创建的 connector、调用 `super().shutdown()`，然后重新抛出。新增的初始化步骤要放进这个 `try` 里。
- [AFD-I38] 模块级符号替换的作用域要尽量窄，并在 `finally` 中恢复
  - 目前有三处替换，各自只在一个窗口内生效：
    - `_use_afd_ubatch_wrapper_during_load` 只在 `super().load_model` 期间把 `gpu_model_runner.UBatchWrapper` 换成 `AFDUBatchWrapper`；
    - `AFDAttentionWorker.init_device` 只在 `super().init_device()` 期间替换 `native_runner_module.GPUModelRunner`；
    - V2 只在 `capture_model` 内替换 `v2_cudagraph_utils.prepare_inputs_to_capture`。
  - 这些替换依赖上游在调用时按模块属性查找符号。改动时要保留 try/finally 恢复，不要扩大替换窗口。
  - `init_device` 必须在调用 `super().init_device()` 之前，用 `get_afd_model_config(...)` 替换 `vllm_config.model_config` 和 `self.model_config`。否则 runner 会用非 AFD 的模型身份构造。
  - `_install_afd_ubatch_wrapper` 有两个分支：模型已经是 `AFDUBatchWrapper`，或需要先 unwrap 原生 `UBatchWrapper`。
  - 两个分支都必须调用 `configure_afd_context_provider(self.install_afd_metadata_on_forward_context)`。新增分支漏掉这一步，ubatch 前向就拿不到 AFD metadata。
- [AFD-I39] `_determine_batch_execution_and_padding` 的 `args` 元组必须和 `_batch_execution_values` 的名称表逐位对齐
  - `args` 按位置构造，再由 `_batch_execution_values` 用 `zip(..., strict=False)` 映射成名字。
  - 如果上游签名插入或调换了参数，或者这里元组的顺序变了，映射会静默错位（例如把 `num_reqs` 当成 `num_tokens`），不会报错。
  - 改其中一处时，要同时改另一处，并对照上游签名核对。
  - DP=1 时，`_should_ubatch_single_rank` 必须保留三道守卫：`num_tokens < num_ubatches`、`check_ubatch_thresholds`，以及基于 padded `batch_descriptor.num_tokens` 的 `is_last_ubatch_empty`。DP>1 分支要保留“第一个 ubatch 不能为空”的检查。
  - ubatch 只支持 `num_ubatches == 2`，runner 和 worker 都通过 `fail_if_unsupported_ubatching` 检查。
  - `_afd_is_graph_replaying` 在这里由 `_is_warmup`、`_afd_is_graph_capturing` 和 `CUDAGraphMode.FULL` 算出，所以调用前这两个标志必须已经设置正确。
- [AFD-I40] V1 `_build_attention_metadata`：先 stage AFD 事务，再临时关闭 `supports_update_block_table`
  - `_afd_pending_metadata` 必须在调用 `super()._build_attention_metadata` 之前，用 `ubatch_slices` 和未 padding 的 `num_tokens` 构建好。这样 `_model_forward` 里的 install 会复用这个事务，而不是按 context 的 token 数另建一个。
  - 有多个 ubatch 时，要遍历每个 ubatch 的 builder 并关闭 `supports_update_block_table`。只记录原本为 True 的 builder（按 `id` 去重），并在 `finally` 中恢复。漏掉恢复会让之后所有步骤都失去 block-table 快速更新。
  - 这是针对 vLLM PR #48659 的临时绕过。升级 pinned vLLM 时应评估能否删除，不要扩大它的作用范围。
- [AFD-I42] V2 FULL replay hook 只作用于单个 manager 实例、不可重入，且只能在 `_use_afd_execution_context` 内使用
  - hook 只在 `cudagraph_mode == CUDAGraphMode.FULL_DECODE_ONLY` 且 `cudagraph_manager` 存在时启用。
  - 它用 `MethodType` 覆盖单个 manager 实例的 `run_fullgraph`，用 `_AFD_FULLGRAPH_HOOK_MARKER` 防止嵌套。退出时恢复之前的实例覆盖，或者 `del` 掉实例属性。不要改成修改类属性。
  - replay 的 metadata 先用真实的 `real_tokens`（`scheduler_output.total_num_scheduled_tokens`）构建，再把 `tokens_lens` 改成 padded 的 `desc.num_tokens`；DP 控制同样用 padded 数。`tokens_unpadded_lens` 保持真实值，两者不要合并成一个。
    - 上述构建和发送描述适用于单 stage。
    - v0.30 GPU MRV2 多 stage 的控制已经由 native prepare seam 发布，FULL replay 必须复用，按 [[attention-runtime-rules]]（stage metadata 规则）（源链接 `#gpu-mrv2-dbo-stage-metadata--原生-stage-只附加隔离的-afd-元数据`） 检查，不能再发送单 stage payload。
  - hook 自己只恢复 `_afd_is_graph_replaying`。
  - `_afd_pending_metadata`、`_afd_suppress_metadata_send`、`_is_warmup`、`_afd_is_graph_capturing` 都靠外层 `_use_afd_execution_context` 的 `finally` 恢复，所以不能在这个作用域之外单独使用 hook。
- [gpu-mrv2-instance-seam] GPU MRV2 prepare 包装只覆盖当前实例并恢复方法
  - 触发：修改 v0.30 GPU MRV2 的 `_use_afd_ubatch_preparation` 或接入同一 native `UBatchRunner.prepare` 边界；本节适用于包含该升级实现的 checkout，不扩大 v0.26 基线的支持范围。
  - 必须：记录当前实例是否已有 `prepare` 覆盖及原覆盖值，在 `finally` 中恢复原覆盖或删除临时实例属性。委托原绑定方法完成 native 输入切片、Attention metadata 和线程/stream 准备；注释写明缺少回调的原因、上游签名、delegation 例外以及上游提供 prepared-state 回调后的移除条件。
  - 验收：无预存覆盖、有预存覆盖和异常退出都恢复 `prepare`；native 准备仍调用一次，外层状态恢复测试覆盖 pending、suppress 和 capture/replay 标志。^[PR #424]
- [gpu-mrv2-dbo-stage-metadata] 原生 stage 只附加隔离的 AFD 元数据
  - 触发：修改 v0.30 GPU MRV2 的 stage 准备、`install_mrv2_ubatch_metadata`、capture 或多 stage FULL replay。
  - 必须：保留 native slices 的传输长度和全 batch 偏移；为每个 stage 克隆 metadata，保留 `stage_idx` 并只附加该 stage 的 `tokens_start_loc`、`requests_start_loc`、`tokens_lens`、`tokens_unpadded_lens`。未填充长度按 `max(0, min(stop, num_tokens_unpadded) - start)` 与真实输入求交。
  - 必须：由调用方在微批线程执行前发布完整控制；多 stage FULL replay 核对 pending metadata 存在且 stage 数等于 descriptor 的 `num_ubatches`，然后复用已发布控制。capture 按 `(num_reqs, num_tokens, num_ubatches)` 匹配事件，不匹配或事件数不完整必须报错。
  - 验收：stage metadata 修改互不污染；padding 范围之外的 stage 未填充长度为零；控制发送次数和 descriptor 三个维度的负例都有 focused tests，正常退出和异常退出保留外层状态恢复保证。^[PR #424]
- [AFD-I43] NPU Async CAM stage 构建必须把 builder 0 留给全批次，并保持单 stage 的 AFD 事务
  - 全批次 metadata 已由 builder 0 构建，并在 stage 执行期间一直存活。因此 Async CAM stage 构建时用 `ASYNC_MOE_STAGE_METADATA_BUILDER_OFFSET + ubid` 选 builder。
  - native DBO（`is_async_moe_stage_build=False`）的 offset 保持为 0。改动 offset 或 builder 的选择方式，会让 stage metadata 覆盖全批次 metadata 正在使用的可复用缓冲。
  - `isolate_deepseek_attention_builder_inputs` 只对 async stage 构建调用，而且不能省略，因为多个 stage 的 metadata 会同时存活。
  - async 路径必须置 `self.ubatch_slices = None`，并以单 stage（`build` 时传 `None`）构建 `_afd_pending_metadata`。否则 `_model_forward` 会把 stage 切片写进 `forward_context.ubatch_slices`，走上 DBO 路径。

## 决策与踩坑

- [gpu-mrv2-instance-seam] 禁止：为此替换 runner 类或模块全局函数、复制重写 native 准备逻辑，或把恢复方法覆盖误写成恢复所有 runner 状态。pending metadata 和执行标志仍由外层 execution/capture 作用域恢复。
- [gpu-mrv2-dbo-stage-metadata] 禁止：重新切片 native input views、Attention metadata 或 worker contexts；从微批线程发送控制；多 stage replay 再发送旧的单 stage payload。
