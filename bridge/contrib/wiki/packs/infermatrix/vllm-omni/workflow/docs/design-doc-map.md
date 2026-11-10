---
name: design-doc-map
description: 官方 docs/design/** 设计文档地图（main @ 1ff27534 复核）：module 页均为 draft、旧四页移入 module/archive 无 redirect、ownership 投影与 CODEOWNERS、#5833/#5839 DLO 与 quantization、#5914 stage-based overview，以及官方文档到知识树 owner 的对照表
metadata:
  scope: 只收官方 design 文档到知识树 owner 的地图与各页 draft/归档状态；ownership 投影细则归 owners-rules，DOCGEN-1c 的 feature taxonomy 归 generation-and-support-rules，各 owner 的运行时合同回对应 component/model 页
---
# 官方设计文档地图（docs/design/**）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/docs/design-doc-map.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, docs；created: 2026-07-16；updated: 2026-09-04
- 来源（sources）：PR #5139；PR #5833；PR #5839；PR #5914；PR #5958；PR #6045；docs/features/README.md；docs/user_guide/diffusion/startup_and_loading.md；docs/user_guide/diffusion_features.md；.github/CODEOWNERS；docs/.nav.yml；docs/design/index.md；docs/design/module/；docs/design/module/archive/README.md
  - docs/design/ar_diffusion_pipeline_capability.md；docs/design/architecture_overview.md；docs/design/feature/diffusion_continuous_batching.md；docs/design/feature/distributed_layerwise_offload.md；docs/design/feature/omni_async_output_materialization.md
  - docs/design/feature/quantization.md；docs/user_guide/diffusion/execution_modes.md
- `main @ 1ff27534` 复核。官方 `docs/design/index.md` 与 `docs/.nav.yml` 按 architecture、feature、infrastructure/performance 和 21 个 module 页面编排。module frontmatter 的 owner、代码路径、依赖与验证路径可作 review 首跳 source map；但本批页面全部是 `status: draft`，其中 invariant 编号也明确只是 candidate，不能覆盖当前代码与测试。
  - 尤其 `module/vllm_omni_config.md` 是 `deferred-pending-refactor`，没有稳定 precedence、环境变量捕获、canonical config 或 invariant namespace。
- 旧四页已移入 `module/archive/` 并从导航移除，只能作为历史叙述；有用结论须先与当前代码/测试复核。上游刻意没有为旧 URL 留 redirect，因此外部深链会 404。owner 与 `required_reviewers` 是不同角色，不能用 document steward/technical owner 冒充独立验证批准。
- module frontmatter 的 `owners` + `primary_code_paths` 现在是 `vllm_omni/**` ownership 的 edit-first source map，少数 `primary_code_path_owners` 为子路径追加 owners；`.github/CODEOWNERS` 是 last-match-wins 的 GitHub 执行投影。它没有自动生成/parity test，具体维护与冲突边界见 [[owners-rules]]（ownership projection rules）。
  - ownership metadata 的变化不改变下表 runtime owner 的行为合同；仍须回 live code/tests 验证。^[PR #5958]
- 此前 #5833/#5839 增加 DLO 与 quantization design；`cpu_offload_diffusion.md` 重命名为 `cpu_offload.md` 且保留 MkDocs redirect，并删除误导性的 `ray_based_execution.md`。
  - 目标 pin 仍有 `distributed/ray_utils/`、`worker_backend`、`ray_address`，但 diffusion executor 明确报 Ray backend 尚未支持，placement-group/actor helpers 也没有 live caller，不能据残留宣称 runtime support。`docs/design/ar_diffusion_pipeline_capability.md` 仍未列入索引，找 spec 时还须检查实际文件树。
- #5914 将 overview 从 `OmniRouter` 和三类 AR/DiT 图改为 stage-based 地图：四个代表模型、指标词汇、engine/orchestrator/runtime/connector ownership、五层 config/runtime resolution、feature 与 public interface。
  - 它是跨 owner 导航，不是新 runtime 支持证据：MiniMax-H3 的 encoder/DiT/VAE 仍是同一 registered diffusion stage 内的 component/phase，独立 placement 需要未来 multi-stage pipeline；Cosmos3 reasoner/generator 同样在一个 diffusion stage。overview 的 typed config 图是 conceptual；
  - 目标代码中 `create_from_model()` 委托 `VllmOmniConfig.from_pipeline_config()`，但稳定生产 startup 仍走 legacy stage 构造，所以不能据图宣称 typed cutover 完成。duplex 也仍是 experimental。PR 只报告 strict MkDocs build（仍有既存 navigation/link warnings）与 diff hygiene，没有 runtime 测试；
  - 代表模型的 batching/attention/parallelism/quantization 表须回各 live owner 验证。^[PR #5914]
- Feature user guide、design contract、recipe 与 support claim 的分层和 nav 验收见 [[generation-and-support-rules]]（DOCGEN-1c；源锚点 #docgen-1c-feature-taxonomy-只拥有可发现性不生成-support-事实）。^[PR #6045]
- （以下为原表格，按行改写为条目）
- 官方文档：`architecture_overview.md`
  - 一句话：stage 定义、Qwen3-Omni/HunyuanImage-3.0/MiniMax-H3/Cosmos3 代表映射、指标词汇、system/config/interface 概念图；具体 support 仍回 live owner
  - 知识树 owner：[[serving-architecture]]（serving）、[[configuration-architecture]]（configuration）、[[distributed-architecture]]（distributed） + [[qwen-omni-overview]]（Qwen）/[[hunyuan-image3-overview]]（Hunyuan）/[[minimax-h3-overview-1]]、[[minimax-h3-overview-2]]（MiniMax）/[[cosmos3-overview]]（Cosmos3）
- 官方文档：`module/{entrypoints,vllm_omni_config,input_output_modality_contracts,error_contracts,engine_orchestration,stage_runtime,omni_connector,model_integration,ar_runtime}.md`
  - 一句话：serving/config/I-O/error/engine/stage/connector/model/AR 的 draft ownership 与 source map；candidate invariant 尚非规范
  - 知识树 owner：对应 [[serving-overview]]（serving）、[[configuration-overview]]（configuration）、[[distributed-overview]]（distributed）、[[scheduler-overview]]（scheduler）、[[model-executor-overview]]（model-executor）
- 官方文档：`feature/omni_async_output_materialization.md`
  - 一句话：AR decode 关键路径外的异步 D2H 与 Omni payload 构造；含 live connector ownership、平台验证范围和同步 fallback
  - 知识树 owner：[[model-executor-overview]]（model-executor）
- 官方文档：`module/diffusion/{index,diffusion_runtime,diffusion_model_integration,continuous_batching,parallelism,offloader}.md`
  - 一句话：diffusion draft module 边界与首跳路径
  - 知识树 owner：[[diffusion-architecture]]（diffusion）
- 官方文档：`module/{execution_platforms,cache_management,quantization,observability,profiling,benchmarking}.md`
  - 一句话：横切模块的 draft owner/source map
  - 知识树 owner：对应组件 owner；行为仍以代码和测试为准
- 官方文档：`module/archive/{async_omni_architecture,ar_module,dit_module,entrypoint_module}.md`
  - 一句话：历史快照，不是 active contract；旧路径无 redirect
  - 知识树 owner：仅作 provenance，改动路由到 active module 页
- 官方文档：`feature/disaggregated_inference.md` + `omni_connectors/*`
  - 一句话：connector 选择矩阵与逐后端 spec
  - 知识树 owner：[[connector-backends]]（distributed）
- 官方文档：`feature/diffusion_continuous_batching.md` + `user_guide/diffusion/execution_modes.md`
  - 一句话：合并后的开发者设计与用户配置入口：request/step 执行、两种 batching、统一 output stream
  - 知识树 owner：[[step-and-batching]]（diffusion）
- 官方文档：`feature/async_chunk.md`
  - 一句话：跨 stage 分块流式
  - 知识树 owner：[[async-chunk]]（distributed）
- 官方文档：`feature/cache_dit.md`、`teacache.md`、`prefix_caching.md`
  - 一句话：缓存加速
  - 知识树 owner：[[cache-acceleration]]（diffusion）
- 官方文档：`feature/{tensor,pipeline,sequence,expert,cfg,vae}_parallel.md`、`hsdp.md`
  - 一句话：并行策略
  - 知识树 owner：[[parallelism]]（diffusion）
- 官方文档：`feature/distributed_layerwise_offload.md` + `user_guide/diffusion/cpu_offload.md`
  - 一句话：DLO 的 DP/SP/TP/HSDP compatibility、AllGather 与 rank-local loader 合同；部分组合仅有配置级验证
  - 知识树 owner：[[rules-checkpoint-loading-1]]、[[rules-checkpoint-loading-2]]（diffusion rule DIFF-2e）
- 官方文档：`feature/quantization.md` + `user_guide/quantization/overview.md`
  - 一句话：diffusion quantization factory、component routing、checkpoint metadata 与验证边界
  - 知识树 owner：[[rules-checkpoint-loading-1]]、[[rules-checkpoint-loading-2]]（diffusion rule DIFF-2c）
- 官方文档：`metrics.md`、`qwen3_omni_tts_performance_optimization.md`
  - 一句话：Prometheus 指标；TTS 性能优化实录
  - 知识树 owner：[[qwen-omni-architecture]]（qwen-omni）（perf 部分）
- 官方文档：`docs/configuration/*`
  - 一句话：配置 schema spec
  - 知识树 owner：[[configuration-architecture]]（configuration）
- 官方文档：`docs/contributing/ci/*`
  - 一句话：L1–L5 与 markers
  - 知识树 owner：[[test-tiers]]（ci guides）
- 官方文档：`docs/contributing/model/*`
  - 一句话：加模型三条路径
  - 知识树 owner：[[adding-a-model]]（adding-a-model）
