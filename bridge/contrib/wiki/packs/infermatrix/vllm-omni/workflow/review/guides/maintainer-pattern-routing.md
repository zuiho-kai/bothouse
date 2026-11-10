---
name: maintainer-pattern-routing
description: PR intent 到 maintainer owner 路由：冻结 head/base 快照、按 PR 描述命中主 owner 再用 changed files 校验、共享路由包，及 PR 描述/风险信号到 Model resolver、各组件与模型 rules 页的路由表（19 个 PR 来源）与完成标准
metadata:
  scope: 只收把 PR 描述路由到知识 owner 的步骤、路由表与完成标准；各 owner 规则正文回对应 rules 页，模型适配完整性归 model-adaptation-guardrails-1、model-adaptation-guardrails-2，模型验证归 model-validation，目录总述归 review-overview
---
# PR intent 到 maintainer owner 路由

## 关键事实

- 源页：`knowledge/repos/vllm-omni/review/guides/maintainer-pattern-routing.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, review；created: 2026-07-20；updated: 2026-09-04
- 来源（sources）：InferMatrixCopilot Issue #24；PR #3576；PR #3642；PR #4106；PR #4281；PR #4341；PR #4718；PR #4730；PR #4980；PR #5001；PR #5031；PR #5037；PR #5052；PR #5084；PR #5087；PR #5088；PR #5136；PR #5157；PR #6049
- 置信度（confidence）：high
- 本页只负责把 PR title/body 的声明目标路由到知识 owner，不复制各 owner 的规则。changed files 用于校验真实范围，不是首要导航。看到关键词不能直接报 finding；必须先证明当前 diff 的 producer、consumer、失败路径与链接规则一致。通用执行合同见 review execution contract（源链接 `../../../../general/review/guides/review-execution-contract.md`）。

### 先固定快照，再按描述选 owner

1. 记录 review head 和 base；base 不是 head 祖先时使用 merge-base，不能把后来 main 的改动算进 PR。
2. 一次性读取 PR title/body，用声明的模型、组件、迁移目标、公开入口或核心符号命中下表的主 owner，再进入该 owner 的快速代码地图选择规则组和第一批源码。
3. 一次性解析 changed files 和完整 diff，验证描述路由是否覆盖所有真实 scope；描述与 diff 冲突时以 diff 为准并明确记录，不能静默换 owner。
4. 生成共享路由包：`owner/model → 规则组 → 第一批源码 → changed files`。后续 caller 搜索、测试和 findings 只向这份包追加，不能让 correctness、subtraction 或专项各自重走。
5. finding 的改动点必须位于 pinned diff；未改文件只能证明影响链，不能把既有问题冒充本 PR 回归。只有 live 调用链跨模块时才增加第二 owner。

### PR 描述 / 风险到 owner

- 这张 always-on 表只保留总入口。模型名、别名、architecture 或 `model_type` 统一进入 [[models-catalog]]（Direct 模型代码入口；源锚点 #direct-模型代码入口），由三处 live registry 解析到 AR/diffusion models 目录；命中专属模型规则地图时再进入对应 `rules.md`。

| PR 描述或风险信号 | 主 owner | 重点 |
|---|---|---|
| 任意模型名、别名、architecture、pipeline/model registry key | [[models-catalog]]（Model resolver；源锚点 #direct-模型代码入口） | 搜三处 registry → folder/module/class → AR/diffusion models 目录 |
| `model_extras`、shared image-task examples、canonical prompt envelope | [[rules-image-task-envelope]]（Model Executor rules；源锚点 #exec-6a-shared-image-example-先建-canonical-envelopemodel-extra-只做特化变换） | example owns task envelope；registry 只做 model-specific transform；再按命中模型追加 owner |
| HunyuanImage3、`extra_body`、AR prompt/tokenizer | [[hunyuan-image3-rules-1]]、[[hunyuan-image3-rules-2]]（HunyuanImage3 rules） | registry、server/offline seam、默认值与 fallback |
| `tests/diffusion/quantization`、可选包 import、硬件支持文档 | [[ci-environment-gotchas-1]]、[[ci-environment-gotchas-2]]（CI environment） | 未安装环境、真实 kernel、claim 一致性 |
| benchmark 脚本、percentile、warmup、replica isolation | [[performance-evidence-1]]、[[performance-evidence-2]]（performance evidence） | 计时、统计、失败退出、完整 key set |
| 模块移动、compat shim、重复 class/schema | API surface（源链接 `../../../../general/review/guides/code-taste-api-surface.md`） | identity、旧行为、返回合同 |
| checkpoint adapter、component quantization、graph/eager、HSDP/FSDP | [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules） | namespace/consumer、数值 parity、真实 fully_shard |
| composable strategy、stage YAML、headless override | [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Config rules） | wired axis、拓扑单源、显存预算 |
| runtime bridge、`runtime_info`、`OmniOutput` | [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor rules） | producer→consumer、逐请求 batch |
| prefix-cache side stream、pinned host tensor | [[scheduler-rules-1]]、[[scheduler-rules-2]]（Scheduler rules） | buffer 生命周期、CPU fallback |
| connector backend、KV transfer、load balancer、跨 stage 端口 | [[distributed-overview]]（Distributed map；源锚点 #direct-代码快速入口） | put/get、connector lifecycle、replica selection、route port |
| SSE/audio format、artifact readiness、Prometheus replica stats | [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving rules） | 首 chunk 前校验、cache capability、owner 生命周期 |
| Cosmos3 Edge/Distilled | [[cosmos3-rules-1]]、[[cosmos3-rules-2]]（Cosmos3 rules） | scheduler、RNG、zero、offload |
| FLUX.2、Mistral text encoder FP8 | [[flux2-rules]]（FLUX.2 rules） | component prefix、量化排除项、meta/offload |
| Krea 2 | [[krea2-rules]]（Krea 2 rules） | dtype、config fetch、online/capability |
| MiniCPM-o 4.5 | [[minicpm-o-4-5-rules-1]]、[[minicpm-o-4-5-rules-2]]、[[minicpm-o-4-5-rules-3]]（MiniCPM-o rules） | registry、remote code、TTS bridge/batch |
| Ming dense/MoE、CFM CUDA Graph | [[ming-omni-tts-rules]]（Ming-TTS rules） | solver dtype、CFG、last step、lazy import |
| Qwen3-TTS、`ref_audio`、x-vector/ICL | [[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（Qwen3-TTS rules） | readiness 方向、一次重算、engine 存活 |

### 完成标准

- 大 diff 最终按 scope ledger 回看 loader/registry/bridge/output、RNG/优化 parity、streaming preflight、并行设备合同和异步资源生命周期是否实际适用并已检查。整个 pinned head 只输出一篇 comment，包含：
  - 当前 diff 做了什么；
  - 沿哪个调用/数据路径造成什么用户或系统结果；
  - 验证过的文件、测试或命令；
  - 本 PR 内的具体最小修法。
- 主审查已经收集的文件、caller 搜索、测试和 findings 必须直接复用。只有关键词相似、尚未验证 consumer 的内容留在调查记录，不作为阻塞意见；只有新颖、矛盾或未覆盖的高风险合同才发起有边界的专项追问。新模型还需同时使用 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model adaptation guardrails） 和 [[model-validation]]（model validation）。
