---
name: ffn-runtime-rules
description: FFN 角色运行时（worker / model runner）审查规则 AFD-I45…AFD-I55，覆盖 graph key、REPLAY 分支、NPU 互调终止性、层集合与收发顺序、token 计数、V2 runner 注入、control_plane 分流
metadata:
  scope: 只收 FFN 角色运行时（worker / model runner）的审查规则 AFD-I45、I46、I47、I48、I50、I51、I54、I55；架构归 ffn-runtime-architecture，仓库级门禁归 afd-plugin-rules
---
# FFN 角色运行时（worker / model runner）审查规则

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/ffn-runtime/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: afd-plugin；created: 2026-09-30；updated: 2026-09-30；sources: 无

- [AFD-I45] graph 缓存的写入 key 与查询 key 必须由同一函数、同一参数计算
  - GPU 写入 `_cuda_graphs` 和查询它时都用 `make_ffn_graph_key(dp_metadata_list)`。NPU 统一走 `self._make_graph_key`，额外参数为 `attention_size`、`ffn_size` 和 `fallback=self.max_num_tokens`。
  - 只改一处（例如 NPU 某处直接调用 `make_ffn_graph_key(dp_metadata_list)`）会让 replay 一直 miss，静默退回 eager，或者反复 capture。
  - NPU 发现 key 已存在时跳过 capture，GPU 则直接覆盖。改 key 粒度时要同时评估这两种行为。
- [AFD-I46] REPLAY 分支不执行 `_ffn_forward` 的 Python 代码，host 侧逻辑只在 capture 时运行一次
  - `graph_run_mode` 返回 `AFDGraphRunMode.REPLAY` 时，`execute_model` 只调用缓存 graph 的 `replay()` 就返回。此时不会执行 `update_state_from_dp_metadata`，`_ffn_forward` 里的元数据赋值、`_set_moe_layer_index`、日志和计数也都不会执行。
  - 在 `_ffn_forward` 中新增需要每步生效的 host 侧逻辑，会在 replay 时被静默跳过。这类逻辑必须放在 replay 早返回之前，或者本身就是能被录入 graph 的设备操作。
  - capture 时的 recv、compute、send 必须全部可录制。缓存条目中的 `"output"` 张量要保留引用，删掉它可能导致 graph 使用的内存被释放。
- [AFD-I47] NPU `execute_ffn_step` 与 `execute_model` 互相调用，终止性依赖两处条件保持一致
  - `execute_ffn_step` 在 `use_aclgraph and (is_graph_capturing or is_warmup)` 时进入 `capture_model`。否则调用 `execute_model`，且不转发 `is_warmup` / `is_graph_capturing`。
  - `execute_model` 传给 `graph_run_mode` 之前，用 `graph_enabled`（即 `use_aclgraph`）屏蔽这两个标志。只有得到 WARMUP/CAPTURE 时才回调 `execute_ffn_step`，而同一条件下 `execute_ffn_step` 一定会进入 `capture_model`。
  - 以下改动都要重新确认不会无限互调，也不会把 capture 请求当作 eager 执行：开始透传这两个标志、去掉 `and graph_enabled` 屏蔽、让两处使用不同的开关。
- [AFD-I48] FFN 侧的层集合和 (layer, stage) 收发顺序必须与 Attention 侧逐层发送一致
  - 循环结构固定为外层按层、内层按排序后的 `stage_ids`。每个 (layer, stage) 恰好一次 `recv_attn_output` 和一次 `send_ffn_output`。改顺序或次数会让 connector 阻塞或错配层。
  - `compute_gate_on_attention` 时，层集合在 GPU 上来自 `self.model.get_experts_layer_indices()`，在 NPU 上来自 `_ffn_layer_indices` → `_is_moe_layer`（依据 `n_routed_experts`、`first_k_dense_replace`、`moe_layer_freq`）。否则层集合为 `range(num_layers)`。修改这些判定时，必须与 Attention 侧的远端 MoE 层集合同步。
  - NPU layered W4A8 路径要求 `get_async_cam_w4a8_layers()` 返回的 `layer_idx` 与 `_ffn_layer_indices(self)` 完全相等。新增模型时不能绕过这项校验。
- [AFD-I50] `aggregate_ffn_token_counts` 的分块须与 `build_rank_mapping` 一致，每个 peer 先取 `max(1, ...)` 再求和
  - 每个 FFN rank 的 Attention 块必须通过 `afd_plugin.distributed::subgroup_attention_block` 获取。分块规则是连续、大小相差至多 1，并支持 3A2F 这类不能整除的情况。不要内联改成 `attention_size // ffn_size` 等分切片。
  - 零 token 的 peer 也贡献一行 placeholder，所以要对每个 peer 先 `max(1, count)` 再求和，缺失的 peer 用 `fallback`。把 `max(1, ...)` 挪到求和之后，4A2F 的 `(0, 4, 5, 6)` 会从 `(5, 11)` 变成 `(4, 11)`，与实际收到的行数不符。
  - NPU 的 `_ffn_token_counts_across_ranks` 是独立实现：要求整除，先求和再 `max(1, ...)`，fallback 为 `max_num_tokens`。改任一侧的计数语义时，要对照该平台 connector 实际下发的行数确认，不能默认两者共享语义。
- [AFD-I51] DP 与 AFD rank 之间的计数展开和投影依赖 TP rank 连续编号，长度不整除时会静默透传
  - `project_ffn_token_counts_to_dp` 和 NPU `_to_dp_level_token_counts` 都假设 FFN 计数排布为 `[dp0, dp0, dp1, dp1, ...]`，即同一 DP 下的 TP rank 连续且计数相同，并取每组的第一个。反向展开时（`aggregate_ffn_token_counts` 的 `expanded_counts`、NPU 的 `tp_size` 展开），同样假设 Attention rank 按 DP 连续编号。
  - rank 编号若改为交错排布，这些函数不会报错，但会静默取到错误的计数。
  - 长度不能被 `dp_size` 整除时，两个投影函数原样返回。下游 `AFDDPMetadata` 和 `ascend_forward_context(num_tokens_across_dp=...)` 会拿到长度不等于 `dp_size` 的计数，而 vLLM 的 `DPMetadata` 要求恰好 `dp_size` 项。新增拓扑时要确认满足整除。
- [AFD-I54] GPU V2 runner 注入点：临时替换模块符号必须在 `finally` 中恢复，model config 要在构造 runner 前写回
  - V2 路径把模块级 `gpu_model_runner_v2.GPUModelRunner` 临时替换为 `GPUFFNModelRunner`，让 `super().init_device()` 构造出 FFN runner。必须用 `try/finally` 恢复原符号，否则同一进程里后续构造的 native runner 会变成 FFN runner。
  - V2 路径中，`get_afd_model_config` 的结果必须在 `super().init_device()` 之前写回 `self.vllm_config.model_config` 和 `self.model_config`，因为 runner 在 `super().init_device()` 内部构造。V1 路径则在其之后替换 config，再显式构造 runner。调整顺序时两条路径要分别检查。
  - `GPUFFNModelRunner.__init__(vllm_config, device)` 的签名要与 vLLM V2 `Worker.init_device` 构造 `GPUModelRunner` 的调用方式保持兼容。
- [AFD-I55] 按 `connector.control_plane is None` 分流：GPU 只支持控制面驱动，NPU 两种模式的入口互斥
  - GPU：`GPUFFNModelRunner.__init__` 断言 `control_plane is not None`，`AFDFFNWorker._run_ffn_server_loop` 遇到 `None` 抛 `NotImplementedError`。`_ffn_forward`、`_dummy_run`、`capture_model` 都直接解引用 `self.connector.control_plane`。
  - NPU：`control_plane is None` 时只能走 `execute_connector_driven_step`。它反向要求 control_plane 为 None，并把 connector cast 为 `CAMAsyncAFDConnector`。`execute_ffn_step`、`_ffn_forward(update_connector_state=True)` 和 `_capture_graphs` 都要求有控制面。
  - 新增调用点必须按同一判定分流：connector-driven 路径不能调用 `update_state_from_dp_metadata` 或 graph capture，控制面路径也不能调用 `recv_ffn_work_item`。
