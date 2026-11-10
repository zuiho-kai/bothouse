---
name: connectors-rules
description: NPU connector（CAM async / CAMP2P）review 规则 AFD-CAMP-430-counts、AFD-CAMP-430-padding、AFD-I58、AFD-I59、AFD-I62…AFD-I66，覆盖物理计数、动态 padding、work item、extra config、进程组、DP 元数据、custom op 状态和 ids 通道
metadata:
  scope: 只收 afd-plugin NPU connector（CAM async / CAMP2P）的 review 规则；connector 当前合同归 connectors-architecture，仓库级门禁归 afd-plugin-rules
---
# NPU connector（CAM async / CAMP2P）review 规则

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/connectors/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin；created: 2026-09-30；updated: 2026-10-09
- 来源：
  - afd-plugin@036640618fc6df6f2c44c67979b91c5c66b0b5a0:afd_plugin/connectors/npu/camp2p.py
  - afd-plugin@036640618fc6df6f2c44c67979b91c5c66b0b5a0:tests/unit/connectors/test_camp2p_connector.py
- [AFD-CAMP-430-counts] Legacy DBO 的真实 Attention 长度与物理 wire 长度必须分开
  - 触发：修改 `codex/v030-main-integration` 分支中 PR #430 引入的 Legacy NPU CAMP2p 多 stage、Attention ranks 大于 FFN ranks 的传输；该规则不声明此分支能力已经进入 main。
  - 强制：control plane 使用独立物理 payload，先将 DP counts 展开到 TP peers，再按 `(ratio, ffn_size)` 的 strided 接收组取每列最大值并重复；
    - 本地 connector state 与发送的 control payload 必须使用同一物理计数，原始 Attention payload 保持真实 query 长度。
  - 验收：覆盖 2A1F、4A2F、DP→TP 展开和等量 ranks；逐 stage 核对发送与本地物理计数一致、输入 counts 不变。真实 native A2E/E2A 检查 wire rows 与 control counts 相符，返回前缀仍使用原始长度。 ^[PR #430]
- [AFD-CAMP-430-padding] 动态 CAMP2p padding 必须在 opaque runtime op 内读取当前 stage
  - 触发：修改 PR #430 的 Legacy NPU CAMP2p split-stage send 路径；作用域为 `codex/v030-main-integration` 中该修复，GPU 与新 NPU MRV2 DBO 不在此规则范围。
  - 强制：仅在 `attn_size > ffn_size` 且 connector 有多个 stage 时，从当前 forward context 的 `ubatch_idx`、`additional_kwargs["afd_metadata"].connector` 读取本 rank 物理 token 数；
    - 在 opaque op 内按差值为 hidden states 补零，只有 expert IDs 存在且需要 padding 时才同时补齐 IDs/scales。
    - 进入该多 stage 路径后，即使 padding 为零，也必须把 transfer batch size 更新为物理计数。
  - 验收：同一 runtime op 在切换实时 stage metadata 后正确处理无 padding 与有 padding，参数化覆盖 IDs 缺失/存在；
    - 断言 native send 张量与 batch size 的物理长度、原始前缀与零尾部，以及每 stage 独立状态。
    - native 观测必须核对实际 wire rows，不能只检查 host 计数。 ^[PR #430]
- [AFD-I58] async CAM FFN 侧：`token_nums_rankid_layeridx` 必须原样回传，真实层号和 token 数只来自 CAM 元数据
  - `afd_async_dispatch_recv` 返回的 `batch_info` 存为 `states.token_nums_rankid_layeridx`，`send_ffn_output` 必须把它原样传给 `afd_async_combine_send`。
  - 其中 `[0]` 是整个 rank 的总 token 数，而本次 chunk 的 token 数来自 `group_list.sum()`。不能为了对齐 `num_tokens` 去切片或重建这个张量。
  - `recv_ffn_work_item` 依赖的布局是：`[0]` 为总 token 数，`[2]` 为 layer_idx。算子布局变化时要同步修改这里。
  - FFN 侧调用 `recv_attn_output` 时传的是 `layer_idx=0` 和容量大小的 `batch_size`，之后 `states.layer_idx`/`states.batch_size` 不会再更新。下游必须使用 `AFDAsyncFFNWorkItem.layer_idx`/`num_tokens` 或 `metadata.layer_idx`，不能读 `states` 里的这两个值。
  - `hidden_states` 和 `states.dynamic_scales` 必须切到同一个 `num_tokens`。
  - 三个标量目前通过一次 `torch.stack(...).cpu()` 读取。新增的 host 读值应并入这次读取，不要再加一次 D2H 同步。
- [AFD-I59] async CAM：零 token 的 FFN work item 也必须 combine-send，并且用浮点占位张量
  - 每个 `AFDAsyncFFNWorkItem` 都要走一次 `send_ffn_work_item_output`。`num_tokens == 0` 时如果跳过发送，Attention 侧的 `afd_async_combine_recv` 会一直收不到数据。
  - 零 token 分支发送的是形状 `(1, hidden)`、dtype 为 `self.activation_dtype` 的全零张量。
  - 这里不能复用 `recv_output.hidden_states`：开启 `dynamicQuant` 时它是 int8，CAM combine-send 不接受。
  - 该方法可能返回替换后的 `ffn_output`。调用方如果还要继续处理，必须用返回值，而不是原来的输入。
  - `_send_ffn_output_payload` 只发送 `AFDF2ATransferPayload.routed_output`。给 payload 新增的字段不会经 CAM 回传，需要单独处理。
- [AFD-I62] `connector_extra_config` 白名单、`from_mapping`、`to_mapping` 与 dataclass 字段必须同步修改
  - `from_mapping` 用 `_AFD_ASYNC_EXTRA_CONFIG_FIELDS` 和 `_CAMP2P_EXTRA_CONFIG_FIELDS` 拒绝未知 key。新字段如果只加到 dataclass、没加进白名单，用户配置会直接报 unknown field。
  - 外部 key 名属于对外契约：
    - `dynamicQuant` 对应属性 `dynamic_quant`；
    - `ATTN_RANKS_PER_DP_CONFIG_KEY` 必须与白名单里的 `attn_ranks_per_dp` 一致。
  - `to_mapping` 会省略值为 `None` 的可选字段。新增字段要保证 `from_mapping(x.to_mapping()) == x`。
  - 新字段要经过 `coerce_extra_*` 系列函数做类型校验，不能直接用 `raw.get(...)` 的结果。
- [AFD-I63] CAMP2P：进程组创建顺序和 ubatch→HCCL group 映射
  - 所有 rank 都在同一个 `tcp://host:port` 上 rendezvous，所以各 rank 执行 `init_afd_connector` 的调用序列必须一致：
    1. 先按 ubatch 创建 HCCL 组 `afd`、`afd1`、…，world 大小为 ffn + attn；
    2. 再由 FFN 单独创建 `afd_moe`；
    3. 最后由参与者创建 gloo 组 `p2p`。
  - 改变顺序、改组名，或者只在一种角色上加组，都会让 rendezvous 卡住。Attention 和 FFN 两侧的 `parallel_config.num_ubatches` 必须相同。
  - 算子只接收三个组名。`_get_group_ep` 把 ubatch 0/1/2 映射到 `hccl_comm_name`/`hccl_comm_name2`/`hccl_comm_name3`：
    - 只有一个 ubatch 时，ubatch 1 退回组 0；
    - 缺第三组时，ubatch 2 直接报错；
    - ubatch ≥3 会静默落回组 0。
    - 要支持更多 ubatch，必须同时修改 custom op 签名和 `_get_group_ep`。
- [AFD-I64] CAMP2P DP 元数据组：发送目的地与接收 src 公式必须互为逆映射
  - 发送侧：前 `min_size` 个 Attention rank 以 `p2p_rank = role_rank + min(ffn_size, attention_size)` 向 `dp_metadata_destinations` 发送。
  - 接收侧：FFN 以 `src = p2p_rank % min_size + ffn_size` 接收。
  - 这组公式依赖 `attention_size >= ffn_size`，此时 `min_size == ffn_size`。放宽 `build_camp2p_topology` 里的这项校验，src 公式和 destinations 就不再对应。
  - `participates_in_p2p_group` 选出的 rank 数必须等于 `p2p_world_size = ffn_size + min_size`，否则 gloo 组 rendezvous 会挂住。
  - 这个组用的是 gloo backend，`send_dp_metadata_list`/`recv_dp_metadata_list` 的 wire 张量必须留在 CPU。
  - 非发送者 rank 调用 `send_dp_metadata_list` 会静默返回。
- [AFD-I65] CAMP2P custom op 通过 forward context 传递状态，同一 context 内只能有一个未完成的 send→recv
  - `send_attn_output` 在调用 `torch.ops.vllm.afd_camp2p_send_attn_output` 之前，写入新的 `forward_context.cam_afdtransfer_state` 和 `ubatch_idx`。
  - op impl 用 `ubatch_idx` 选组，并把 A2E 的 `outputs[3]` 写回 `atten_batch_size`。`recv_ffn_output_impl` 依赖这个值。
  - 每个 forward context 只有一个状态槽位。同一 context 内第二次 `send_attn_output` 会覆盖前一次的 `atten_batch_size`，之后再 recv 前一个 ubatch 就会用错数据。如果要让多个 ubatch 重叠，需要按 ubatch 分开存状态。
  - op 本身不接收 ubatch 参数，所以 `recv_ffn_output` 必须先设置 `get_forward_context().ubatch_idx`，再调用 op。
  - 修改 op 签名时，要同步修改 `*_impl`、`*_fake_impl`、`send_annotations`/`recv_annotations` 和所有调用处。
  - 注册受 `_CAMP2P_CUSTOM_OPS_REGISTERED` 保护，并且会吞掉重复注册错误。如果同名 op 已经注册过，改签名不会有显式报错。
  - `send_attn_output` 里新增的 host 侧校验，要像现有 shape 校验一样在 `torch.compiler.is_compiling()` 下跳过，以保留 `FULL_DECODE_ONLY` ACL graph 路径。
- [AFD-I66] CAMP2P ids 通道：Attention 的 `compute_gate` 必须与 FFN 的 `recv_input_ids` 成对选择
  - Attention 传入 `input_ids` 时使用 `compute_gate=1`。FFN 必须用 `recv_attn_output(recv_input_ids=True)` 选择同一种算子模式。
  - 模式必须由调用方显式声明，不能改成按返回张量的形状推断，因为真实的单 token 层和算子占位张量无法区分。
  - 模式 0 下 A2E 的 `outputs[1]` 是未初始化内存，只能在 `compute_gate_mode == 1` 时读取。
  - `prepare_token_id_transfer` 的约束：ids 数必须恰好等于 `metadata.total_tokens`，列数为 `num_experts_per_tok`，scales 全为零（这个通道只传 token 身份，不传路由权重）。
  - `received_token_ids` 的约束：收到的数量必须 ≥ FFN 实际计算的 token 数，然后截断到该值。
  - 放宽这两处校验，按 token 选专家的 router 会给错误的 token 选专家。

## 决策与踩坑

- [AFD-CAMP-430-counts] 禁止：原地覆盖 Attention 元数据，或把各 rank 总体最大值当成每个 FFN 接收组的长度；ratio≤1 或单 stage 时保持原 payload 行为。
- [AFD-CAMP-430-padding] 禁止：在 op 外按 profile/warmup 元数据预先 padding，让编译图冻结动态分支；禁止用物理长度替换 E2A 接收的原始长度 reference，或合并不同 stage 的 transfer state。
- [AFD-I63] 命名陷阱：属性 `self.hccl_comm_name1` 是 `afd_moe` 组（写入 `cam_p2p_ep_name`），而 `_get_group_ep` 的形参 `hccl_comm_name1` 是主 `afd` 组。调用时第一个参数必须是 `self.hccl_comm_name`。
