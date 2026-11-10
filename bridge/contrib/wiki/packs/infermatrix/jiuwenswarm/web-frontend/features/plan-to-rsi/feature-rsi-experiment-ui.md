---
name: feature-rsi-experiment-ui
description: RSI 自我改进实验页（创建/列表/配置回显）：task.create 到 rsiTrainingStart/rsiTaskList 的前后端契约与 ArtifactEngineAdapter Provider 入口、RSI 特性开关与创建表单默认值、HARNESS/PAPER/PROGRAM 三分支表单校验、RsiPage 列表加载与选中、build_request 对 model/model_config 的兼容推断、未执行的 rsi 单元测试入口
metadata:
  scope: 只收 RSI 实验页的现状说明与设计推断（契约、配置、表单、列表流程、单测入口）；RsiPage 挂载加载、CreateExperimentDialog props 与默认值、ConfigInfoDialog 裁剪取舍和 useRsiEvents 订阅的逐点证据归 feature-depth-rsi-experiment-ui
---
# RSI 自我改进实验页（创建/列表/配置回显）

## 现状

- **前后端契约：task.create / dataset.validate 与 Provider 适配接口**
- 前端创建实验走 rsiTaskCreate → rsiTrainingStart（启动）→ rsiTaskList（回查快照）的链路：字段按契约 §6.1 task.create 组装，HARNESS 分支带 input_file/model_refs.optimizer+tester/max_iterations/evaluation_method（'agent' 映射为 llm_as_judge），ARTIFACT 分支按 artifact_type 附加 optimization_instruction/artifact_path/web_proxy；
  - 启动或列表回查失败均被吞掉，不阻断创建反馈。后端 ArtifactEngineAdapter 暴露 run/resume/pause/terminate/read_state/read_report/get_tree/locate_artifact 作为 Provider 的公共入口，validate_input 将 Provider 结果归一为 RsiDatasetResult(valid, sample_count, errors)。
- Sources /
  - 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L247–L316](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L247-L316),
  - [jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py:L370–L398](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py#L370-L398),
  - [jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py:L400–L434](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py#L400-L434)
- **配置项：特性开关、表单默认值与配置回显**
- RSI 特性开关 featureConfig.ts 默认启用（rsiFeatureEnabled = true），normalizeRSIEnabled 把非布尔值按字符串归一，仅 '0'/'false'/'no'/'off' 视为关闭，并通过 useSyncExternalStore 提供响应式读取。
  - 创建表单的默认值：scenario='HARNESS'、artifactType='PAPER'、evaluationMethod='agent'、maxIterations=2（切到 PROGRAM 时重置为 3 但不展示该字段），package_id 固定空串 DEFAULT_RSI_PACKAGE_ID；配置回显由 ConfigInfoDialog 只读展示 task.config 快照（模型、数据集、optimization_instruction、web_proxy 是否配置、artifact_path、max_iterations，按分支条件显示）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/featureConfig.ts:L3–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/featureConfig.ts#L3-L33),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L89–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L89-L103),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx:L28–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx#L28-L65)
- **创建弹窗的三分支表单**
- CreateExperimentDialog 用 useMemo 在每次字段变化时重算校验：HARNESS 分支必填 datasetFile 与 tester；PAPER 分支要求 optimizationInstruction 与 artifactPath 至少其一；PROGRAM 分支必填 artifactPath。切换到 PROGRAM 时重置 maxIterations 为 3 并清空 optimizationInstruction/webProxy，且 showMaxIterations = branch !== 'PROGRAM' 隐藏迭代字段。
  - 选择数据集路径后自动调用 rsiDatasetValidate（带 scenario/artifact_type），失败时按 valid=false 兜底。
- Sources /
  - 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L116–L157](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L116-L157),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L195–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L195-L209),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L318–L319](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L318-L319)
- **现有单元测试入口（未执行）**
- 两类 helper 单元测试存在于 tests/unit_tests/rsi/（本输入仅做符号定位，未执行）。test_paper_provider.py 用 FakeRuntime 替换 ManagerRuntime，断言传给 runtime 的 config/request 组件与 usage 台账记账；
  - test_artifact_files_service.py 构造真实目录与 ZIP 文件，经 RsiArtifactFilesService.list_files/read_file 验证产物可浏览与可读（涉及文件系统，非纯函数断言），并在 L88-L100 断言 provider_best_artifact 对同一 best 节点取最新 artifact_index 引用。
- Sources / 来源：[tests/unit_tests/rsi/test_paper_provider.py:L49–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/rsi/test_paper_provider.py#L49-L130),
  - [tests/unit_tests/rsi/test_artifact_files_service.py:L17–L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/rsi/test_artifact_files_service.py#L17-L44),
  - [tests/unit_tests/rsi/test_artifact_files_service.py:L88–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/rsi/test_artifact_files_service.py#L88-L100)
- **RsiPage 的列表加载与选中流程**
- RsiPage 是实验页主组件：挂载期间通过 useRsiEvents(true) 订阅推送事件，进入页面时用 loadList() 拉取实验列表；列表加载完成后若尚未选中任务，自动 selectTask 选中第一个任务。创建成功的回调 handleCreated 先 upsertListItem 把新任务写入列表，再 selectTask 切换到该任务；页面按是否有选中任务在 RsiRail+RsiDetail 与 RsiIntroduction 之间条件渲染。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L28–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx#L28-L56),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L60–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx#L60-L78)
- **build_request 对 model/model_config 双契约的兼容**
- Inference / 设计推断（非作者历史意图）：
- ArtifactEngineAdapter.build_request 在构造请求时同时兼容 agent-core 旧的 model_config 占位与新版 model 对象两种字段：仅当 ArtifactEngineRequest 定义了 model 字段、模型解析结果为 None 且 requires_model 为真时才抛 RsiNotReady("optimizer model 未注册")；若请求只有 model_config 字段，则直接写入 model_id，即使 requires_model 为真也不校验是否解析到模型。
  - 代价是旧字段路径下未注册模型不会被提前拦截，收益是与上游字段演进保持边界兼容。
- Sources / 来源：[jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py:L355–L368](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py#L355-L368)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-rsi-experiment-ui.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L247-L316
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py:L370-L398；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py:L400-L434
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/featureConfig.ts:L3-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L89-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx:L28-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L116-L157
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L195-L209
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L318-L319
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/rsi/test_paper_provider.py:L49-L130；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/rsi/test_artifact_files_service.py:L17-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/rsi/test_artifact_files_service.py:L88-L100；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L28-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L60-L78；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py:L355-L368
- 源页字段（feature）：rsi-experiment-ui
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx
  - jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py；jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiDetail.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiRail.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/rsiStore.ts
  - jiuwenswarm/channels/web/frontend/src/features/rsi/featureConfig.ts；jiuwenswarm/channels/web/frontend/src/features/rsi/types.ts；jiuwenswarm/channels/web/frontend/src/features/rsi/styles/rsi.css；jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiIntroduction.tsx
  - jiuwenswarm/channels/web/frontend/src/features/rsi/mockData.ts；jiuwenswarm/channels/web/frontend/src/features/rsi/rsiPresentation.ts；jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiSelectedInfo.tsx；jiuwenswarm/agents/harness/common/rsi/paper_provider.py
  - jiuwenswarm/agents/harness/common/rsi/projector.py；jiuwenswarm/channels/web/frontend/src/features/rsi/useRsiEvents.ts
