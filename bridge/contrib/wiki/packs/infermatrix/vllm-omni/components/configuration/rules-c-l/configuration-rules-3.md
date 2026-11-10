---
name: configuration-rules-3
description: vLLM-Omni 配置开发门禁（3/3）：CONF-3a 至 3d（最终展开配置为准、deploy_config 唯一入口、模型专用 deploy profile、checkpoint 身份与架构路由）、CONF-6a（MOSS-TTS-Local 采样参数）、VOMNI-CFG-2a 至 2c（延迟导出、轻量 pipeline registry、backend 参数 reachability）、VOMNI-CFG-3a（环境变量同步）、CONF-3e（dots.tts 与 Dynin-Omni 删除）
metadata:
  scope: 只收 CONF-3a 至 3e、CONF-6a、VOMNI-CFG-2a 至 2c 与 VOMNI-CFG-3a；入口表与 VOMNI-CFG-1a 至 1i 归 configuration-rules-1，VOMNI-CFG-1j 至 1o 与 CONF-1a 至 CONF-2c 归 configuration-rules-2，speech_cache（CONF-SPEECH-1a）归 rules-speech-cache，VOMNI-CFG-2d 归 rules-diffusion-attention-precedence
---
# vLLM-Omni 配置开发门禁（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[configuration-rules-1]]；第 2 部分 [[configuration-rules-2]]
- 源页：`knowledge/repos/vllm-omni/components/configuration/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-10-09

### 部署配置与资源预算

- [CONF-3a] 争议以展开后的最终配置为准
  - 触发：CLI、deploy YAML、`base_config` overlay、platform 覆盖、per-stage override 或 `engine_extras` 各层说法不一致。
  - 强制：以 `resolve_deploy_yaml → load_deploy_config → merge_pipeline_deploy → build_stage_runtime_overrides` 展开后的最终逐 stage 配置核对阶段运行时字段。
    - API 进程专属顶层字段不投影到 stage：`speech_cache` 以 `resolve_deploy_yaml → load_deploy_config` 得到的 `deploy.speech_cache` 和 API speech serving 的实际 consumer 为准，见 [[rules-speech-cache]]（CONF-SPEECH-1a）。
    - overlay 中的显式 `null` 也是有语义的值：例如 MUSA Qwen3-Omni profile 在 Talker 与 Code2Wav 用 `hf_overrides.quantization_config: null` 清除 checkpoint root 的 ModelOpt metadata，避免 BF16 audio stage 被自动识别为量化；Thinker 与非 MUSA base 保持不变。
  - 验收：阶段运行时字段在最终逐 stage 对象中可读回，并与第一位 consumer 一致；API 专属 section 在最终 deploy 对象和 API consumer 读回，不要求其出现在 stage args。平台 overlay 同时断言受影响 stage 和未覆盖 control，不能只验证 YAML 原文。^[PR #5671] ^[PR #7883]
- [CONF-3b] 显式 deploy YAML 统一经 `deploy_config` 解析
  - 触发：修改 `Omni`、`AsyncOmni`、`OmniEngineArgs`、orchestrator 参数或阶段解析链中的显式 YAML 配置入口。
  - 强制：将 `deploy_config` 作为唯一显式 deploy YAML 入口；未提供时走模型默认配置解析，并让 CLI、headless、offline、runner 和测试调用方使用同一字段，直到最终逐 stage 配置可读回。
  - 验收：覆盖显式 `deploy_config`、未提供配置时的模型默认回退，以及标准/headless/offline/runner 传播路径，断言最终 stage config 一致，并确认公开参数与内部 args 不再包含 `stage_configs_path`。 ^[PR #5741]
- [CONF-3c] 模型专用 deploy profile 必须真正自动生效
  - 触发：新增带模型专用 side-path 或多模态输出标记的 AR pipeline，并同时提供默认 deploy YAML。
  - 强制：让 model config、architecture registry、pipeline registry 与 `default_deploy_config_name` 指向同一模型；对 dots.tts 保持 `enforce_eager: true` 与 `enable_prefix_caching: false`，并从未显式传入 deploy 配置的真实 `Omni` 初始化中核对最终逐 stage 值；在 prefix-cache merge 尚未保留 `sparse_audio` 前，不得移除该 pin。
  - 验收：用 HF `model_type=dots_tts` 的无显式配置启动路径断言 architecture、pipeline、默认 deploy 文件和最终 flags 一致，并完成超过一个 160 ms patch 的离线生成，确认没有 prefix-cache 导致的单 patch 截断。^[PR #4765]
- [CONF-3d] checkpoint 身份与模型架构路由必须分层闭合
  - 触发：checkpoint 的 `config.json` 自报为上游 backbone，但 Omni 需要独立的 model architecture、pipeline 和默认 deploy 配置时。
  - 强制：让 model registry、pipeline registry、`model_arch`、`default_deploy_config_name` 与 deploy stage 的 `hf_overrides.architectures` 闭合指向同一模型；保留 backbone 的 `model_type`，并让无显式配置的入口解析打包的 deploy YAML。
  - 验收：真实无显式 deploy 配置的初始化能读回最终 pipeline 与 architecture，backbone `get_text_config()` 仍解析为原模型类型，并覆盖 registry、默认 YAML 与最终 stage config 的一致性。 ^[PR #5666]
- [CONF-6a] MOSS-TTS-Local 部署必须采用官方采样参数
  - 触发：修改 MOSS-TTS-Local 的 deploy YAML 或其默认采样参数时。
  - 强制：采用 MOSS-TTS-Local 官方示例参数：`temperature=1.7`、`top_p=0.8`、`top_k=25`、`repetition_penalty=1.0`；如需变更，必须有模型级行为证据支持。
  - 验收：解析 `vllm_omni/deploy/moss_tts_local.yaml`，断言上述参数与官方示例一致，并确认最终 stage 配置实际读取这些值。 ^[PR #6156]
- [VOMNI-CFG-2a] 配置公开导出必须延迟加载以保持导入链无环
  - 触发：修改 `vllm_omni.config` 的公开导出，或新增会经 pipeline registry、模型 pipeline 与 diffusion 数据模块回环的配置导入路径。
  - 强制：对会 eagerly 导入 `pipeline_registry`、`StageConfigFactory` 或其他重型 pipeline 依赖的公开配置符号使用模块级延迟解析；首次访问时通过 `importlib` 解析并缓存真实对象，同时保持 `__all__`、`__dir__` 与直接子模块导入的身份一致。导入链测试必须在干净解释器中先验证轻量配置导入不会预加载 registry/PI0，再验证公开导出仍解析到直接实现。
  - 验收：静态检查顶层导入不含重型 registry/factory，干净子进程按 `vllm_omni.config.lora` → `vllm_omni.diffusion.data` 顺序导入成功，并断言 `StageConfigFactory`、`register_pipeline` 与直接模块导出的对象相同；覆盖仍需用这些公开符号的调用方。^[PR #6293]
- [VOMNI-CFG-2b] pipeline registry 必须只依赖轻量拓扑配置
  - 触发：修改 `pipeline_registry.py` 的模型拓扑注册，或配置/插件导入链可能在配置解析期间预加载模型 runtime。
  - 强制：将 registry 所需的静态 `PipelineConfig` 放入无 runtime 副作用的轻量模块；registry 只导入该模块，runtime pipeline 继续 re-export 同一对象以保持既有导入路径，并用干净子进程验证 registry 解析不加载 runtime。
  - 验收：隔离进程中导入并解析目标 registry key，断言对应 runtime module 不在 `sys.modules` 且返回的 `PipelineConfig` 身份与字段正确；再验证 runtime 的兼容导入路径仍 re-export 同一拓扑对象。^[PR #6322]
- [VOMNI-CFG-2c] backend 专用参数必须有完整 typed reachability
  - 触发：为 diffusion attention backend 新增 CLI、环境、deploy 或 structured config 参数。
  - 强制：参数必须在 `StageDeployConfig`、orchestrator/CLI、normalization、`AttentionSpec` 和 `backend_kwargs` 间保持同一 canonical 值，并验证从每个公开入口到 backend consumer；只允许相应 backend 接受，且在无法实际稀疏执行的 shape/Top-K 组合显式记录或验证 fallback。
  - 验收：覆盖有效非默认值的 CLI、deploy/structured 和 direct attention-config 路径，断言最终 `backend_kwargs`；覆盖错误 backend、非正值，以及 Top-K 超过 runtime block count 的回退。`WanDMDPipeline` 一类 checkpoint alias 还必须由 `model_index.json` 自动发现。^[PR #4820]

### [VOMNI-CFG-3a] 环境变量 consumer、分类和公开合同同步

- 触发：新增、重命名或删除环境变量读取，包括实验性优化开关。
- 强制：同批核对 consumer 与 `environment_variable_inventory.py` 分类；公开变量同步 `docs/configuration/environment_variables.md`，写明默认值、精确启用值、读取时机和依赖开关。分类数量快照只能在逐项核对新增/删除集合后更新。
- 验收：`tests/config/test_environment_variables.py` 的静态读取分类、文档和数量检查通过，并确认启用值到达真实 consumer；重命名后旧名称无未解释读取。 ^[PR #7648]

### [CONF-3e] 已删除的 dots.tts 与 Dynin-Omni 不得残留注册面

- 触发：改 `pipeline_registry.py`、`environment_variable_inventory.py` 或 `vllm_omni/deploy/`，或试图恢复 `dots_tts` / `dynin_omni`。
- 强制：pipeline import 与 `OMNI_PIPELINES` key、各 inventory 桶中的 `DOTS_TTS_*` / `DYNIN_*`，以及默认、CI、multiconnector deploy YAML 必须同时缺席。共享注释不得指向已删实现。
- 验收：registry 无这两项 key，deploy 目录无对应 YAML，inventory 无上述名称。^[PR #7655]

## 决策与踩坑

- [CONF-3a] 禁止：拿某一层 YAML 原文当生效值；用默认值脑补缺失字段。
- [CONF-3b] 禁止：在该解析链中恢复 `stage_configs_path` 字段、双路径互斥判断、格式探测或 legacy `stage_args` 直接加载分支；不得让旧参数静默改变最终配置。
- [CONF-3c] 禁止：以 YAML 文件存在或 pipeline key 存在推断默认配置已经自动加载；只验证原始 YAML 而跳过最终 stage config；覆盖 `enable_prefix_caching` 后仍宣称 dots.tts 输出合同不变。
- [CONF-3d] 禁止：只注册 pipeline 或放置 YAML 就依赖 `model_type` 推断；用 `hf_overrides.model_type` 替代 stage architecture 路由；要求离线入口额外传参来弥补默认配置未接通。
- [CONF-6a] 禁止：沿用通用默认采样值，或仅凭经验调整敏感采样参数而不核对官方示例。
- [VOMNI-CFG-2a] 禁止：在 `vllm_omni.config` 包初始化阶段无条件导入会反向加载 `DiffusionOutput` 的 registry；用 import 顺序或已预加载模块掩盖循环；删除公开导出或让 lazy proxy 与直接导入得到不同对象。
- [VOMNI-CFG-2b] 禁止：让 `pipeline_registry` eager import 模型 runtime、依赖已预加载模块或导入顺序掩盖循环；不得因拓扑模块轻量就改变模型 runtime 的实际加载语义。
- [VOMNI-CFG-2c] 禁止：只把字段加到 schema、只在 CLI 解析，或让 deploy projection 静默丢弃；不得把 backend 专用值作为未经类型校验的任意 dict 透传。
- [VOMNI-CFG-3a] 禁止：因为变量是 experimental 就省略分类；只改数量断言，或把 consumer 的精确字符串比较描述为接受任意 truthy 值。
- [CONF-3e] 禁止：只删模型代码却留下 key、env 名或 YAML；rebase 时恢复 `DOTS_TTS_PIPELINE` 或 `DYNIN_OMNI_PIPELINE`；再把已删除模型的旧 deploy pin 当作在运合同。
