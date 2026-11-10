---
name: model-integration-rules
description: AFD 模型包装（afd_plugin/model_executor/models）评审规则 AFD-I15…AFD-I30，覆盖权重角色分类、远端 FFN 代理协议、router_logits、FFN 侧 MoE 构造、native 属性、NPU 延迟导入、CAM dispatch、async stage 规划和 metadata 物化
metadata:
  scope: 只收 AFD 模型包装（afd_plugin/model_executor/models）的评审规则 AFD-I15、I21、I22、I24、I25、I26、I28、I29、I30；架构归 model-integration-architecture，仓库级门禁归 afd-plugin-rules
---
# AFD 模型包装（afd_plugin/model_executor/models）评审规则

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/model-integration/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin；created: 2026-09-30；updated: 2026-09-30；sources: 无

- [AFD-I15] V2 `_checkpoint_weight_roles` 与 `AFDDeepseekV2DecoderLayer.__init__` 的分支必须一一对应
  - `_is_moe_layer` 复制了 `__init__` 里 `is_moe_layer` 的判定，依据是 `n_routed_experts`、`first_k_dense_replace` 和 `moe_layer_freq`。改了其中一处，另一处必须同步改。否则权重会被分到没有构造该模块的角色上，加载时要么静默丢失，要么报 unexpected key。
    - dense 层在 `compute_gate_on_attention` 时由 Attention 构造 `native.DeepseekV2MLP`，FFN 侧是 `PPMissingLayer`。
    - MoE 的 `mlp.gate` 在 `compute_gate_on_attention` 时两侧都持有，所以返回 `_BOTH_ROLES`。
    - `mlp.shared_experts` 只在 `AFD_ASYNC_CONNECTOR` 下归 Attention：由 `GateOnlyRemoteMoE` 构造，FFN 侧不构造。
  - `load_weights` 传入的 `attention_shared_experts=... == AFD_ASYNC_CONNECTOR` 必须和 `GateOnlyRemoteMoE.shared_experts` 的构造条件使用同一个判断。
  - 如果某个角色新增或删除子模块，或者改变了 `self_attn`/`mlp` 下的命名，必须在分类函数里补对应分支。
  - `_iter_role_weights` 必须是只消费一次的生成器。不要对 checkpoint 迭代器做 `list()`，也不要遍历两次。
- [AFD-I21] 远端 FFN 代理必须按 send → DBO yield → recv 的顺序执行，并使用同一个 `stage_idx`
  - `RemoteFFNProxy._send_and_receive` 和 `RemoteDeepseekV4FFN.forward` 是同一个协议的两份实现，改一处必须同步另一处。步骤依次是：
    1. 取 `forward_context.ubatch_idx` 作为 `stage_idx`，没有时回退到 `afd_metadata.stage_idx`，并把它写回 `afd_metadata.stage_idx`。
    2. 调用 `send_attn_output`。
    3. 调用 `maybe_apply_dbo_yield(..., role=\"attention\")`。
    4. 调用 `recv_ffn_output(ref_tensor=..., ubatch_idx=stage_idx)`。
  - 如果把 yield 挪到 send 之前或 recv 之后，DBO 两个 ubatch 的通信和计算就不再重叠，收发还可能错配。
  - `recv_ffn_output` 的 `ref_tensor` 必须是 yield 返回的张量。`create_attention_metadata` 的 `seq_len` 必须等于发送张量第 0 维的长度。
  - 额外的 send kwargs 必须和 FFN 侧消费的内容一致：
    - V4 必须发送 1-D、与 token 对齐的 `input_ids`。这由 `AFDDeepseekV4ForCausalLM.afd_requires_input_ids = True` 声明，并由 `AFDDeepseekV4DecoderLayer.compute_ffn_output` 强制要求。
    - V2 的 `AFDAttentionFusedMoE` 明确拒绝 `input_ids`。
- [AFD-I22] CUDA remote experts：是否发送 `router_logits`，必须与 FFN runner 的外部路由模式成对
  - 只有在 `is_internal_router=False`（即 `compute_gate_on_attention`）时，Attention 侧的 `AFDAttentionFusedMoE` 才发送 `router_logits`。
  - FFN 侧在同一条件下设置 `self.mlp.experts.gate = None`，让 runner 走外部路由；`compute_experts_output` 以 `is_internal_router` 作为守卫。两侧的条件必须一致。
  - `get_experts_routing_spec` 用 `layer.mlp.gate.out_dtype or gate.weight.dtype` 和 `layer.mlp.n_routed_experts` 生成图捕获用的静态 spec，因此：
    - `AFDDeepseekV2RemoteExpertsMoE` 必须保留 `n_routed_experts`。
    - `GateLinear(out_dtype=native._get_moe_router_dtype(config))` 必须与 native gate 一致。
  - Attention 侧在 `compute_gate_on_attention=False` 时 `gate` 为 `None`，这时调用 `get_experts_routing_spec` 会抛 `AttributeError`。新增调用点时必须确认对应组合下存在 gate。
  - 两个角色各自计算 `uses_remote_experts`（`device_type == \"cuda\" and is_moe_layer`），得到的层集合必须相同，不能让它依赖 role。
  - `AFDAttentionFusedMoE.update_expert_map` 是空实现，而 Attention 侧会在 `enable_eplb` 时拒绝启动。放开 EPLB 之前，必须先实现真实的 expert map。
- [AFD-I24] FFN 侧构造 MoE：在私有配置副本上用 `None` 关闭 shared experts；在 NPU 上先刷新 `FusedMoE` 绑定再构造
  - 在 `AFD_ASYNC_CONNECTOR` 下，FFN 侧先 `copy(config)`，再对副本执行 `object.__setattr__(moe_config, \"n_shared_experts\", None)`。
  - 只能改副本：原始 `config` 还会被 `_checkpoint_weight_roles`、`GateOnlyRemoteMoE` 以及后续各层读取。
  - 哨兵值必须是 `None`：写 `0` 会构造出一个零宽 MLP。
  - 在 NPU 上，`native.FusedMoE = fused_moe.FusedMoE` 必须在构造 `native.DeepseekV2MoE` 之前执行：native 模块在 import 时就绑定了 `FusedMoE`，而 AFD 可能早于 vLLM-Ascend 打补丁就导入了它。不要把这条赋值移到模块顶层或构造之后。
- [AFD-I25] 绕过 native `__init__` 的包装类，必须自行设置 native forward/load_weights 会读取的所有属性
  - 以下类都直接调用 `nn.Module.__init__`，但仍复用 native 的 `forward` 或 `load_weights`（例如 `super().forward`、`super().load_weights`）：`AFDDeepseekV2RemoteExpertsMoE`、`AFDDeepseekV2DecoderLayer`、`AFDDeepseekV2Model`、`AFDDeepseekV4DecoderLayer`、`AFDDeepseekV4Model`。
  - 因此不要删除下列属性：`is_sequence_parallel`、`n_logical_experts`/`n_physical_experts`/`n_local_physical_experts`、`use_mha`、`num_redundant_experts`（代码注释写明 Needed by load_weights）、`aux_hidden_state_layers`、`make_empty_intermediate_tensors`、`routed_scaling_factor`、`use_sequence_parallel_moe`，
    - 以及 V4 的 `hc_head_*`、`_mtp_hidden_buffer`、`use_mega_moe`。
  - 缺少这些属性时，往往只在 EPLB、PP、fp16 这类特定路径上才会报错。
  - 每个 patch 头都记录了 vLLM v0.26.0 和 commit `568afb3a13806beb53bb2e6bd518269357b237c0`，`### PATCH START/END` 之外的代码应与该 commit 的 native 实现保持一致。升级 vLLM 时，必须重新 diff native `__init__`，补上新增的属性，并更新 patch 头。
- [AFD-I26] `afd_plugin.model_executor.models.npu` 只能在函数内部延迟导入
  - `deepseek_v2.py` 在 CUDA 和 NPU 上都会被导入，而 `npu` 子模块在顶层导入了 `vllm_ascend`（例如 `deepseek_attention_metadata.py`）。
  - 目前所有 npu helper 都是在函数内部导入的：`GateOnlyRemoteMoE.forward`、`compute_attn_output`、`compute_ffn_output`、`AFDDeepseekV2Model.forward`。
    - 在 CUDA 或 CPU 环境下导入会失败。
    - `deepseek_v2_async_cam_forward.py` 只在 `TYPE_CHECKING` 下反向导入 `deepseek_v2`，提到顶层会形成循环导入。
  - 新增的 NPU 专属路径也必须采用延迟导入，并在调用处用 `device_type` 或 connector 做判断。
- [AFD-I28] `prepare_cam_dispatch_payload` 与 `restore_cam_dispatch_output` 必须成对使用同一个 `CAMDispatchLayout`，并且所有 TP rank 都要执行
  - 在非 SP 且 `tp_size > 1` 时：
    - dispatch 按 ceil-div 把复制的 token 维分片，尾部补零。
    - restore 调用 `tensor_model_parallel_all_gather` 拼回完整张量，再截到 `parent_tokens`。
    - restore 必须使用 prepare 返回的 `layout`，不能重新计算。
  - restore 里的 all-gather 是 TP 集合通信。即使本 rank 的分片全是 padding 也必须调用 restore；任何按 rank 或本地 token 数跳过调用的分支都会导致死锁。
  - CAM 输出的第 0 维必须等于 `layout.local_tokens`（包含 padding 行），dispatch 和 combine 之间不要去掉 padding。
  - `topk_weights`、`topk_ids`、`router_logits` 必须与 `hidden_states` 共用 token 维，并按同样的方式切分。新增的 per-token 张量也要经过 `_pad_first_dim(...)[local_token_slice]`。
- [AFD-I29] `AsyncMoeUbatchMetadata` 的 stage 规划不变量是布局还原正确的前提
  - 生成 metadata 的一方必须保证：
    - `attn_metadata` 与 `stages` 长度相同且非空。
    - `token_slice` 从 0 开始，连续、有序、非空。
    - `actual_tokens <= input_tokens`。
    - `parent_input_tokens` 覆盖全部真实 token。
  - 还原时直接对各 stage 裁剪后的输出做 `torch.cat`，再补齐到 `parent_input_tokens`，所以依赖上面的连续性。
  - 在 SP 下，要求 `tp_size > 1`，并且 `parent_input_tokens` 和每个 `stage.input_tokens` 都能被 `tp_size` 整除。
  - 每个 stage 的输出行数必须正好等于其物理 `input_tokens`：SP 下看 all-gather 之后的行数。
  - 还原时只保留前 `actual_tokens` 行，因此真实 token 必须排在 stage 的最前面。
  - positions 的 token 维探测优先 axis 1（对应 `[axes, N]` 形状），`llama_4_scaling` 沿用 positions 的维度。不要改成优先 axis 0，否则遇到方阵形状时会把位置轴误当成 token 轴。
- [AFD-I30] Async CAM 下多份 attention metadata 同时存活：stage build 之前先隔离输入，每次 build 之后立即物化
  - full-batch、stage-0、stage-1 三份 metadata 都在执行之前构建。vLLM-Ascend builder 返回的 `cos`/`sin` 可能是进程级 RoPE buffer 的视图，后一次 build 会覆盖前一个对象的内容。
  - 每次 build 之后、下一次 build 之前，必须调用 `materialize_deepseek_attention_metadata_by_layer`。
  - 每个 stage builder 调用之前，必须先对该 stage 的 common metadata 调用 `isolate_deepseek_attention_builder_inputs`：
    - SFA 会原地写 `group_len`/`group_key_idx`/`group_key_cache_idx`。
    - DSA 会原地清零 `block_table_tensor` 的 padding 行。
  - 两个函数都靠 `isinstance` 分派，遇到不认识的类型会静默跳过。新增或升级 backend 时必须补上对应分支。
  - DSA 用 `input_positions[: metadata.num_input_tokens]` 重建 RoPE，传入的必须是该 metadata 所属批次的 positions。
