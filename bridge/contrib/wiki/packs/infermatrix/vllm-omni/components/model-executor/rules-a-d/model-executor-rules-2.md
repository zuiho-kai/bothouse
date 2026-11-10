---
name: model-executor-rules-2
description: "Model Executor 规则（2/3）：严格配置校验 EXEC-3a（不靠扩大白名单）、EXEC-3b（stage loader metadata 与 stateful chunk）、EXEC-3c（connector-required stage 的 runner capability，PR #6149）、EXEC-3d（StageRuntime inline 资格，PR #6813）、EXEC-4a（full-duplex chunk metadata）、EXEC-4b（resolved model architecture 与 model-owned hooks）、EXEC-4c（Talker-MTP graph 三态，PR #5671），及 runner _preprocess 预处理合同与 EXEC-4e（exact-shape codec 的 input_ids view，PR #6775）"
metadata:
  scope: 只收“严格配置校验”与“Runner 到模型的预处理合同”两节（EXEC-3a 至 EXEC-3d、EXEC-4a 至 EXEC-4c、EXEC-4e）；路由表见 model-executor-rules-1，EXEC-4d、EXEC-5a、EXEC-5b 与 stage 并行度见 model-executor-rules-3，preprocess phase / one-token prefill 的 EXEC-4f 归 rules-runtime-hot-paths
---
# Model Executor 规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[model-executor-rules-1]]；第 3 部分 [[model-executor-rules-3]]
- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-07-10；updated: 2026-09-05

### 严格配置校验

- [EXEC-3a] 严格配置校验不能靠扩大白名单
  - 触发条件：新增或收紧 stage config、deploy YAML、CLI 到 runtime config 的未知字段校验，或者准备向 projection、`TypedDict`、known-fields 集合、compat/service allowlist 增加字段。
  - 必须做：先冻结 PR 基线，逐个枚举相对基线新增的可接受字段；对每个字段写清公开 producer、入口归一化、唯一 canonical owner 和最终 runtime consumer。CLI/legacy 别名只允许在入口转换，转换后不得继续出现在核心 schema；service-only 字段必须交给 service owner，不能混入 stage runtime config。直接 constructor、结构化 YAML 和真实 startup builder 必须使用同一组最小正负样例核对。
  - 验收：每个新增可接受字段都必须有 PR 前已存在或本次明确新增的真实 consumer，并有从公开入口到 consumer 的正向断言；无 consumer 或 owner 不在 stage runtime 的字段必须在入口报错；别名与 canonical 同时出现必须报冲突。最终 diff 中新增的 schema 字段数量应与 producer-consumer 表逐项一致。
- [EXEC-3b] stage loader metadata 与 stateful chunk 能力必须一同到达 consumer
  - 触发：新增 per-stage `model_subdir`/`tokenizer_subdir`、模型 architecture override，或模型在 async chunk 间保留执行状态。
  - 强制：从 `PipelineConfig`/deploy 合并结果把 checkpoint/tokenizer 子目录和 `retains_state_across_chunks` 传入最终 `OmniStageModelConfig`/runner；空的 `model_arch` 表示使用 checkpoint 自带 architectures，而不是一个空 override。Stateful chunk 必须与 scheduler 的容量计数和 connector requeue 合同一起审查。
  - 验收：structured 与 legacy stage config 都能读回子目录/状态字段；Audex 等多子目录 checkpoint 做 loader smoke；stateful async-chunk 测试证明容量上限、requeue 和 cleanup。
- [EXEC-3c] connector-required stage 必须在 worker 启动前验证 runner capability
  - 触发：stage 增加完整 payload 输入、downstream processor、explicit connector role，或修改 GPU/NPU/XPU worker/runner 选择。
  - 强制：从 `OmniEngineArgs` 的已解析 `worker_cls`（包括 platform 自动选择）读取 `model_runner_cls`；只要 stage 需要 connector，就要求它是 `OmniConnectorModelRunnerMixin` 的子类，并在初始化前以明确错误拒绝不兼容 worker。所有平台 worker 都应把实际 runner 公开为 `model_runner_cls`，不能仅在 `init_device` 内硬编码构造。
  - 验收：覆盖显式兼容/不兼容 worker、platform-resolved worker、无 connector configuration 的 control，以及 GPU、NPU、XPU AR/generation worker 的 runner-class 暴露和 mixin 继承。^[PR #6149]
- [EXEC-3d] StageRuntime inline 资格必须按 whole-pipeline stage 数、replica 与 owner 精确判定
  - 触发：修改 diffusion replica 的 `StageRuntime` inline/subprocess 初始化、pipeline `inline_diffusion`、`custom_pipeline_args` 或 stage/replica topology。
  - 强制：`use_inline` 只能满足 `plan.num_replicas == 1 and (self._num_stages == 1 or inline_diffusion or custom_pipeline_args)`；其中 `_num_stages` 是 whole-pipeline stage 数。默认仅 single-stage/single-replica inline；
    - multi-stage 默认 subprocess，仅显式 `inline_diffusion` 或已有 custom-pipeline in-process owner 可 opt in，且仍须 single replica。
  - 验收：至少覆盖默认 single-stage→inline、two-stage→subprocess、multi-stage 两种 opt-in，以及 multi-replica 对默认/opt-in 的否决。PR #6813 新增的单元测试只参数化默认 one/two-stage，未覆盖 flag、custom、multi-replica 或真实 in-process execution；其 L20X benchmark 仅是所列 workload 的作者证据。^[PR #6813]
- [EXEC-4a] full-duplex chunk metadata 必须按 span 隔离且可安全序列化
  - 触发：`experimental/fullduplex` 修改 PCM/audio span、force-listen、rollback、resumable append、runtime-control 或 silence continuation。
  - 强制：把 speech/PCM metadata 与 rollback 状态绑定到具体 span；resumable append 重新 arm 所需 EOS 但不得重复 turn EOS；runtime-control 输出先转换 dataclass/enum 等为 JSON-safe 值，并在等待后重新检查 session/request 是否仍然有效。
  - 验收：覆盖不规则 PCM span、rollback、resumable append、stale continuation 和控制 redaction；首批测试看 `tests/e2e/features/fullduplex/` 下的 input、runtime adapter boundary 与 runtime-control redaction。
- [EXEC-4b] shared runner 必须保留 resolved model architecture 与 model-owned hooks
  - 触发：模型 architecture override 为空、checkpoint 含多个子目录，或模型实现拥有 native duplex/sampling policy。
  - 强制：空 `model_arch` 回退到 checkpoint architectures；loader 先按 resolved architecture 解析 connector/checkpoint 子目录；共享 runner 只提供 typed rows 和 hook seam，真正的 model-owned sampling/turn-boundary policy 由模型 consumer 执行。
  - 验收：覆盖 blank override、多子目录 checkpoint、hook 调用顺序和 mixed-batch request-local metadata；初始化失败必须在 scheduler/worker 继续运行前暴露。
- [EXEC-4c] Talker-MTP graph 能力必须保留 tri-state 语义
  - 触发：修改 Talker-MTP 的 FULL graph wrapper、模型 `talker_mtp_graph_safe`、平台 graph capability，或把 talker 与其他 stage 共用同一层 wrapper。
  - 强制：只有实际 Talker stage 从平台声明模型能力；runner 读取能力时保留三态：未声明 `None` 回退到既有 `has_separate_talker`，显式 `True` 允许 wrapper，显式 `False` 即使存在 separate talker 也必须阻止 wrapper。上述判断只控制 dedicated Talker-MTP FULL graph wrapper，不能跳过 MTP buffer 初始化或关闭该 stage 其余 compile/capture 路径。
  - 验收：CPU runner 测试至少覆盖 explicit false、未声明且 separate talker、explicit true，以及无 separate talker 的非 Talker stage。MUSA 当前 override 为 false，因为其 stream capture 到 `torch.multinomial` 会报 `operation not permitted when stream is capturing`；其他平台沿接口默认 true，但仍受模型声明与 FULL graph mode 共同约束。^[PR #5671]

### Runner 到模型的预处理合同

- 触发条件：修改或排查 runner `_preprocess` 的逐请求 metadata 生产、phase 判定、normal/batched preprocess 选择、MTP 路由条件，或多模型共用的输入预处理合同。
- 主要 owner：先查 `vllm_omni/worker/gpu_model_runner.py` 的 `_preprocess` 和调度状态，再查 `vllm_omni/model_executor/models/` 中命中的 consumer。共享 producer 或路由错误不能只在某个模型内打补丁。
- 必须做：把每个字段的生产时点、Python 类型、逐行语义、normal/batched preprocess 入口和后续路由写成明确 contract；phase 必须来自 prompt progress 等真实调度状态，不能用当前 span 长度代替。
- 回归测试：最近 owner 是 `tests/worker/`。直接调用生产 `_preprocess`，在同一 mixed batch 中放一个应进入和一个不应进入该路由的逐行对照，断言 metadata、hook 调用和 embedding/code 等可观察结果。只在模型 helper 测试里手动喂 metadata，或把真正的后续 helper 整个 mock 掉，不能证明 runner contract。
- MTP 内部行为：只修改 `_talker_mtp_forward` 内部的采样参数、空 batch、output key、graph wrapper 或 generator 生命周期时，使用最近生产 owner 的针对性测试；只有它同时改变逐行 phase 或 `_preprocess` 路由时，才强制上述 mixed-batch 合同回归。
- 平台边界：查 GPU generation/AR runner 和 NPU 等平台是继承共享实现还是覆盖它；没有 live 继承或调用链证据时，不得声称所有平台合同已经一致。
- 文档与兼容：已向 out-of-tree 模型开放的字段必须从 model-contribution 入口可发现，并明确旧 runtime 和新 consumer 需要怎样配套升级；不能用某个 in-tree 模型的 fallback 充当公开合同。
- [EXEC-4e] exact-shape codec 只能取得语义长度的 `input_ids` view
  - **触发：** generation runner 的 graph bucket padding、`_preprocess`、flat `input_ids`、`seq_token_counts`，或 codec 模型以逐请求 token counts 分割输入发生改变。
  - **必须：** CUDA/GPU 与 Ascend NPU runner 都在 `_preprocess` 后、模型前调用同一 opt-in helper；仅 `requires_exact_input_shape` 的模型取得截至 semantic total 的 `input_ids`（GPU `num_tokens_unpadded` 与 NPU `scheduler_output.total_num_scheduled_tokens` 相同）。
    - positions、attention metadata、graph bucket/buffer 和 forward context 继续 padded。以 `seq_token_counts` 精确 `torch.split` flat input 的 codec consumer 必须显式 opt in。
  - **验收：** CPU/mock runner regression 构造 semantic 3 tokens→graph bucket 4，捕获真正进入 model boundary 的 argument：opt-in case 断言 `input_ids.numel() == sum(seq_token_counts) == 3`，exact bucket 不变；negative control（无 flag）仍收 4-token padded view。helper 单测覆盖 flag、缺失 flag、`input_ids is None`；
    - GPU/NPU call site 共用 helper。NPU graph hardware/E2E 须另验，CPU mock 不证明硬件或性能 parity。^[PR #6775]

## 决策与踩坑

- [EXEC-3a] 禁止：不能因为严格校验开始报错，就把报错字段加入核心 dataclass、projection、known-fields 或专门白名单；不能接受字段后在分区时丢弃；不能为同一语义新增两个核心字段再补优先级；不能用“构造成功”“字段不在最终 payload”或只有测试 fixture 使用来证明字段必要。
- [EXEC-3b] 禁止：只在 legacy YAML 或 model helper 中记录子目录；用空字符串覆盖 checkpoint architecture；让 scheduler 看不到仍占用 runner slot 的 parked request。
- [EXEC-3c] 禁止：按 model architecture hard-code connector 初始化 allowlist；等到 request parked 或 connector method 缺失才失败；把无 connector 的普通 async scheduler stage 误判为 connector-required。
- [EXEC-3d] 禁止：把“当前 diffusion stage 是一个”错当 whole pipeline single-stage；仅凭一个 replica inline split Stage 1；让任一 opt-in 绕过 multi-replica 隔离，或称所有 subprocess/共享内存边界都已消除。
- [EXEC-4a] 禁止：用上一 chunk 的 force-listen 或 speech marker 污染不规则下一 chunk；把 stale session 的 silence continuation 继续发送；直接把 Python runtime object 放进控制消息。
- [EXEC-4b] 禁止：用空 override 覆盖 checkpoint metadata；只按默认架构初始化 connector；用 generic runner policy 替换 MiniCPM/Audex 等模型自己的 native policy。
- [EXEC-4c] 禁止：用 `has_separate_talker or talker_mtp_graph_safe` 吃掉显式 `False`；把 platform 默认支持误写成所有模型未声明时一律开启；因一个算子 capture 失败而全局切 eager。
- [EXEC-4e] **禁止：** 不得把 padding token 计入 `seq_token_counts`，不得复用 `requires_raw_input_tokens`（只决定 token IDs 与 embeddings），不得无条件 unpad、只修 GPU/NPU 一侧，或改写 graph capture 的 padded metadata/buffer。
