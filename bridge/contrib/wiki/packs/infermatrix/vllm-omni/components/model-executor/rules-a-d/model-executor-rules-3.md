---
name: model-executor-rules-3
description: "Model Executor 规则（3/3）：async Omni output materialization 的 EXEC-4d（GPU/NPU AR runner duplex hook，PR #6346）、EXEC-5a（snapshot、live drain 与 fallback，PR #5610）、EXEC-5b（NPU KV connector finalize 按 PP 所有权，PR #6096）；stage 并行度与设备容量一起验收及首次根因报告四项；EXEC-14a（typed PretrainedConfig，PR #5877）、EXEC-15a（common/ming，PR #6119）、EXEC-0c（generation capture/replay 的 preprocess 输入路径，PR #5452）、EXEC-16a（GroupNorm 融合算子，PR #6306）"
metadata:
  scope: 只收“Async Omni output materialization”与“Stage 并行度和设备容量必须一起验收”两节及其后的 EXEC-14a、EXEC-15a、EXEC-0c、EXEC-16a；路由表见 model-executor-rules-1，EXEC-3a 至 EXEC-4e 见 model-executor-rules-2，架构职责锚点归 model-executor-architecture
---
# Model Executor 规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[model-executor-rules-1]]；第 2 部分 [[model-executor-rules-2]]
- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-07-10；updated: 2026-09-05

### Async Omni output materialization

- [EXEC-4d] GPU/NPU AR runner 必须在统一采样点接入 duplex hook
  - 触发：GPU/NPU AR runner 或 full-duplex sampling hook 修改 `prepare_duplex_sampling` 的接入与采样顺序。
  - 强制：GPU、NPU sibling runner 共同使用 `DuplexSamplingRunnerMixin`；初始化、模型加载解析和 state 更新走统一 helper，并在 `model_sample` 前对 prepared metadata 应用逐行 hook。
  - 验收：静态测试枚举全部 AR runner，断言 mixin、四个 hook site 与 sampler 前顺序；再覆盖 duplex 行映射和无 hook 模型的 no-op。 ^[PR #6346]
- [EXEC-5a] snapshot、live drain 与 fallback 必须构成同一个 output-cycle 合同
  - 触发：修改 `GPUARModelRunner` async output、background builder、D2H copy、connector output、model opt-in/postprocess，或 prefix cache/spec decode/routed-expert/platform guard。
  - 强制：下一 decode step 会覆盖或 mutate 的 scheduler metadata、request mapping、token span 和 CUDA output 必须先做 step-owned snapshot；可复用 tensor 要 clone，并由独立 stream、pinned host buffer 和 ready event 固定 D2H 生命周期。采样 token feedback 与下一步所需的 model postprocess state 保持 eager。
    - 未 snapshot 的 connector signal 必须只有 background builder 一个 drain consumer；`get_output()` 必须 join builder 并传播 background exception。
  - 验收：覆盖 reusable buffer 被下一 step 覆盖、逐请求 snapshot 隔离、connector drain 次数/顺序、builder exception 和每个 compatibility guard 的 synchronous fallback。平台结论按真实 runner 分开：CUDA/ROCm 已验证，XPU/MUSA 可能进入共享 GPU path 但未验证，Ascend NPU 的独立 runner 仍同步 materialize。 ^[PR #5610]
- [EXEC-5b] NPU KV connector finalize 必须按 PP 所有权延迟
  - 触发：NPU AR 或 generation runner 在 speculative decoding、pipeline parallel 或 `broadcast_pp_output` 场景调用 `maybe_get_kv_connector_output`。
  - 强制：仅当 `self.speculative_config is not None` 且当前 rank 是 `get_pp_group().is_last_rank` 或 `self.broadcast_pp_output` 为真时设置 `defer_finalize=True`；AR 与 generation runner 必须保持相同条件。
  - 验收：覆盖无 speculative config、speculative config、last rank、非 last rank 和 `broadcast_pp_output` 的组合，断言两个 runner 传入 connector 的 `defer_finalize` 值及最终 finalize 时机一致。 ^[PR #6096]

### Stage 并行度和设备容量必须一起验收

- 触发条件：修改或排查全局 CLI、per-stage override、deploy YAML、平台 overlay、stage 并行度、`runtime.devices`、设备映射或 worker 启动。
- 必须做：沿公开入口展开配置合并，记录每个 stage 最终生效的 TP、PP、DP 和其他会增加 local world size 的并行参数，以及解析后的设备列表；在创建底层 worker 前校验所需设备数不超过该 stage 的可见设备数。
- 验收：至少有一个从全局参数加 per-stage override 进入最终配置的负向测试。并行 world size 大于解析后设备数时，测试必须在 worker 创建前失败，并在错误中报告 stage、并行参数、所需设备数和实际设备列表；匹配的配置必须保留原有启动行为。
- 源码中已经存在校验、但实际日志仍越过它继续执行时，必须读完校验所在函数及 caller 的完整控制流，包括后续 `except`、fallback 和返回值。只有代码 diff 或运行环境证据排除控制流吞错后，才可以把原因留给版本或镜像不一致。
- 最终配置、设备容量、被绕过的校验和 worker 失败已经形成一条与用户日志一致的因果链时，根因即闭环，应先报告。只有版本差异会改变这条因果链或修复位置时才继续查 tag、commit 和历史 PR。
- 首次根因报告只需要四项：用户最终配置、runtime 实际设备、失效或被吞的前置校验、与日志一致的失败点。四项齐全就立即给出“结论 / 证据 / 未验证边界”；相关 warning、硬件排除、完整版本历史和扩展修复建议随后按需补充，不得延迟首次报告。
- 当 issue 已提供最终配置和失败堆栈、current source 可读时，先按 [[model-executor-architecture]]（架构职责锚点；源锚点 #当前源码职责锚点） 完成一轮窄调查，目标是在 owner 确定后两分钟内给出首次根因。超时仍未闭环时必须指出缺失证据，不能静默扩大到历史 commit、其他模型或环境猜测。
- Stage 拓扑错误的最小充分源码证据只有三段：一处最终配置日志加全局/per-stage 合并函数；一处启动前容量校验及其完整异常控制流；一处与日志一致的 worker 失败点。三段一致即可决定“配置触发 + fail-fast 缺陷”的主要修复位置，不再为首次结论读取 config factory、模型 pipeline、完整 deploy、spawn 实现或 tag diff；只有三段之间发生冲突时才补这些文件。
- [EXEC-14a] 复合模型配置必须使用注册的 typed PretrainedConfig
  - 触发：新增复合模型的 transformer 配置、嵌套 `llm_config`/`vision_config`，或修改 `transformers_utils.configs` 的 AutoConfig 注册与模型加载路径。
  - 强制：为顶层和嵌套配置定义 typed `PretrainedConfig` 子类；从 checkpoint 加载时把嵌套 dict 提升为对应配置对象，并同步完成 `AutoConfig.register`、模块导出和 pipeline 的 `from_pretrained` 消费，默认值集中在 typed config 构造器中。
  - 验收：local 与 HF 配置都能解析顶层及嵌套 model type，断言字段和默认值、AutoConfig 注册及模块导出一致，并用最小真实模型构造覆盖配置对象被 consumer 接收。^[PR #5877]
- [EXEC-15a] Ming-family 可复用模块必须归一到 `common/ming`
  - 触发：第二个 Ming-family 模型复用或重命名 CFM、Aggregator、speaker embedding 等实现，或修改其模型侧构造参数。
  - 强制：可复用实现以 `vllm_omni/model_executor/models/common/ming/` 为唯一归属，`ming_tts` 与 `ming_flash_omni` 从该目录导入；保留 checkpoint-facing 的类和参数语义，模型侧必须显式传入真实 latent width，且 checkpoint 配置覆盖默认值。
  - 验收：共享模块测试断言 `Aggregator`、CFM、speaker extractor 等符号的 `__module__`，确认模型包没有本地重复类；用 Ming-flash 的真实 latent width 构造并断言输出 shape，同时运行 Ming-TTS 与 Ming-flash 的模块回归。 ^[PR #6119]
- [EXEC-0c] **EXEC-0c — generation capture 与 replay 必须保持 preprocess 输入路径一致**
  - 触发：修改 generation runner 的 `_dummy_run`、CUDA-graph capture/replay 输入路径，或模型声明 `has_preprocess`。
  - 强制：generation override 必须在与 base runner 相同的决策点保留 `has_preprocess` 分支；capture 与 replay 必须读取和写入同一对固定 `input_ids.gpu`/`inputs_embeds.gpu` buffer，且不得依赖继承实现的偶然覆盖。
  - 验收：静态 AST contract 同时检查 base `_dummy_run`、base `_preprocess` 和 generation `_dummy_run`，并验证 generation override 实际存在；对声明 `has_preprocess` 的 capture/replay case 断言输入 buffer 与输出行为一致。 ^[PR #5452]
- [EXEC-16a] 共享 GroupNorm 融合算子必须保持 eager、数值与布局合同
  - 触发：在 `vllm_omni/model_executor/models/common/ops/` 增加或复用 `fused_group_norm_silu`、`fused_adaptive_group_norm_silu`，或在混合精度模型中替换 GroupNorm/AdaGN 与 SiLU 组合。
  - 强制：wrapper 必须在 Triton/CUDA 不可用时回退到 eager 实现，支持 `(B, C, *spatial)` 并在计算后恢复原 shape；启动 kernel 前将输入和 `torch.chunk` 产生的 `scale`/`shift` materialize 为所需连续布局；均值和方差使用 FP32 的 Welford/centered reduction，输出 dtype 与 eager GroupNorm 一致，autocast 下保留其 FP32 输出语义。
  - 验收：以 eager reference 覆盖 FP32/FP16/BF16、任意 spatial rank、非 contiguous 输入、chunk-derived `scale`/`shift` 和 autocast；加入大偏移小方差用例验证无 NaN 和有界误差，并分别断言 native fallback、shape、dtype 与 CUDA kernel 数值正确性。^[PR #6306]

## 决策与踩坑

- [EXEC-4d] 禁止：只在 GPU `_sample` 接入而遗漏 NPU；在 `model_sample` 后调用 hook；复制平台专属实现或依赖 import side effect 建立 hook。
- [EXEC-5a] 禁止：把 live connector state 写进 snapshot 清单；让同步路径和 background path 重复 drain；把“CUDA/ROCm 已验证”写成不存在的 platform guard；在 prefix cache、speculative decode、routed-expert output 或非 eager stateful postprocess 下强开异步路径。
- [EXEC-5b] 禁止：仅依据 speculative decoding 开启状态就在所有 PP rank 延迟 finalize，或继续使用不区分 PP 所有权的 `clear_kv_metadata` 反向条件。

### Stage 并行度和设备容量必须一起验收

- 禁止：不能只证明并行参数和设备参数各自解析正确；不能截断设备列表或用 fallback 继续；best-effort 的锁、清理、日志和观测代码不能吞掉配置、拓扑或容量错误。
- [EXEC-14a] 禁止：在 pipeline 内手写 JSON/`SimpleNamespace` 和分散的 `.get` 默认值；只注册顶层 model type 却遗漏嵌套配置；让配置注册、导出和真实 consumer 使用不同的 schema。
- [EXEC-15a] 禁止：在任一 Ming 模型目录保留近似副本，让一个模型跨包导入另一个模型的可复用实现，或在重命名后遗留旧 import；不能依赖 shared `Aggregator` 的默认 `in_channels` 代替模型真实的 `latent_dim`。
- [EXEC-0c] 禁止：capture 读取 `input_ids` 而 replay 由 `_preprocess` 写入 `inputs_embeds`，删除 generation override 后让测试仅因 fallback 到 base 实现而通过，或在不同分支改变 graph 输入语义。
- [EXEC-16a] 禁止：仅凭 `HAS_TRITON` 让非 CUDA、unsupported dtype 或错误布局进入 kernel；使用 `E[x^2] - E[x]^2` 计算方差；对 strided conditioning view 使用 `view`；或用同 dtype 的不稳定 reference、输入 dtype 推断 autocast 输出 dtype。
