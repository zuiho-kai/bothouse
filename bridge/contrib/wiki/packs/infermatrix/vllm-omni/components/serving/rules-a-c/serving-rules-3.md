---
name: serving-rules-3
description: Serving 规则第 3 部分：SERV-2e 指标发射的测量边界与去重、SERV-2d 图像端点透传 stage_durations / peak_memory_mb，SERV-3a–3d artifact readiness、内容身份与 pure-diffusion speech media policy，SERV-11a 用户输入日志降级，VLLM-OMNI-PR9282-DUPLEX-APPEND-GATE 全双工响应门只统计未完成的 response-bound append 任务
metadata:
  scope: "只收 SERV-2d、SERV-2e、SERV-3a–3d、SERV-11a 与 PR #9282 duplex append gate；其余 SERV-2* metrics 规则归 serving-rules-metrics，SERV-1a–1k 归 serving-rules-2，代码地图归 serving-rules-1"
---
# Serving 规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[serving-rules-1]]；第 2 部分 [[serving-rules-2]]
- 源页：`knowledge/repos/vllm-omni/components/serving/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-07-20；updated: 2026-10-23
- [SERV-2e] 指标发射必须保持测量边界、缺失语义与请求唯一性
  - 触发：新增 image/diffusion Prometheus family，或修改 `OmniBase` terminal result、`OrchestratorAggregator`、scheduler snapshot、失败清理或 stage/replica membership。
  - 强制：只在同一 finished result 的首次消费中发射 stage workload；request-finalize family 由 e2e guard 发射一次。保留已测得的零 queue duration，但没有来源的 optional profiler/KV/memory measurement 不发射。failure counter 在 abort、disconnect、stage error 和 cleanup 之间去重，并将 reason 归一到有界 taxonomy。
    - waiting gauge 只求 live replicas 的最新快照，且 abort/error、death 和正常 unregister 都必须刷新或移除旧快照。
  - 验收：覆盖 finished-result replay、present-zero 与 missing、错误/abort cleanup、正常及 dead replica unregister、一次请求的多个 failure path，以及 image-only workload guard。profiler-off 与 profiler-on 均须断言各自可观测合同。^[Issue #5811] ^[PR #6150]
- [SERV-2d] 图像生成与编辑响应必须透传 diffusion 指标
  - 触发：修改 `/v1/images/generations` 或 `/v1/images/edits` 的 diffusion generation result 解包、指标字段或 OpenAI 响应构造。
  - 强制：单 stage 从 result 属性、multi-stage 从返回 tuple 捕获 `stage_durations` 与 `peak_memory_mb`，并在两个图像端点的响应 `metrics` 中透传；指标不可用时保留 `null`，内存值按稳定的数值类型输出。
  - 验收：对 generations 和 edits 分别覆盖 single-stage 与 multi-stage stub 结果，断言响应状态为 200，且 `metrics.stage_durations`、`metrics.peak_memory_mb` 与 generation result 精确一致；同时覆盖指标缺失时的 `null` 响应。^[PR #5999]

### 缓存 readiness 与失败隔离

- [SERV-3a] readiness 必须表达 artifact 能力而非仅表达 identity
  - 触发：serving 层按 URI/key 缓存预处理 artifact，并在后续请求剥离原始输入。
  - 强制：readiness key 或 capability predicate 必须包含 consumer 真正需要的 mode/字段；只有 artifact 已具备全部必需字段时，才能进入 artifact-only 路径。
  - 验收：覆盖“能力不足 artifact → 更强请求”与“能力超集 artifact → 较弱请求”，前者保留原始输入并重新计算，后者是否复用必须作为明确性能取舍。Qwen3-TTS 的方向性合同见 [[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（Qwen3-TTS 规则）。 ^[PR #5157]
- [SERV-3b] readiness 状态迁移与错误存活性一起验证
  - 触发：修改 artifact ready/track/mark/discard、失败清理或 eviction。
  - 强制：所有状态入口使用同一 key/capability 合同；请求级 prompt/build 错误不得杀死 engine，后续健康请求仍应成功。
  - 验收：单测枚举状态迁移；E2E 复现原始坏顺序、证明修复后存活，并在回退修复代码时重新出现目标错误，避免测试空跑。 ^[PR #5157]
- [SERV-3c] 内容身份必须原子贯穿全部缓存层
  - 触发：本地/inline reference audio 或其他 locator 同时经过 decode、speaker/code 与 prefix cache。
  - 强制：先通过 allowed-local-media gate，再规范解析 URI/stat；本地身份至少含 size 与 `st_mtime_ns`。decoded payload 与 identity 一次计算、一起返回，并把同一身份贯穿每层 cache key 和 prefix salt；named voice 加 inline ref 按真实分支区分。
  - 验收：同长度覆盖、并发改写、named+inline、speaker cache 和 prefix hit 均不复用旧内容；非法路径不 stat，日志只含截断值且命中真实 logger hierarchy。 ^[PR #5670]
- [SERV-3d] pure-diffusion speech 必须在 factory 固化 media policy
  - 触发：pure-diffusion speech 绕过普通 `OpenAIServing` 初始化，或修改 `ref_audio` 的 `MediaConnector`、local-media allowlist 或 factory 参数。
  - 强制：app bootstrap 将 `allowed_local_media_path` 和 `allowed_media_domains` 原样传给 speech factory；diffusion instance 在 factory 中创建并持有按该配置构造的 connector，且其 local cache-key stat 使用同一 allowed path。普通 multi-stage instance 仅在首次需要时从 `model_config` 构造 connector，不能要求 diffusion instance 拥有 `model_config`。
  - 验收：pure-diffusion bootstrap 断言两个 media 参数到达 speech factory；在 allowlisted 本地 ref-audio 上断言 connector 只按该配置创建一次，文件 size/mtime 改变后 cache miss 并 refetch；普通 multi-stage 路径仍从 `model_config` 延迟构造。 ^[PR #6622]
- [SERV-11a] 用户输入日志必须默认降级并受限输出
  - 触发：修改 TTS、audio generation 或 diffusion chat serving 请求日志，以及 `request_logger` 或 `max_log_len` 的行为。
  - 强制：INFO 级别只记录 request ID、模型类型、voice clone、reference image 和参数等元数据；用户输入仅在 `self.request_logger` 存在时通过 `logger.debug` 输出，并按 `max_log_len` 预留日志前缀长度进行截断；未配置上限时使用 200 字符默认上限。
  - 验收：覆盖 TTS、diffusion TTS、audio generation 和 diffusion chat，断言 INFO 不含用户内容；启用 `--enable-log-requests` 时 DEBUG 才输出内容，且配置与未配置 `max_log_len` 时均遵守截断上限。 ^[PR #6329]

### [VLLM-OMNI-PR9282-DUPLEX-APPEND-GATE] 全双工响应门只统计未完成的 response-bound append 任务

- 触发：修改 `vllm_omni/engine/duplex/session/context.py` 中 append 任务的跟踪与清理、`has_response_bound_append_tasks` / `cancel_append_tasks`，或 barge-in/VAD 之后新回合的响应门判定。
- 强制：响应门只统计 `response_bound` 且尚未 `task.done()` 的 append 任务；已运行完成但仍留在 `append_tasks` 里等待 done callback 清理的任务，不得在 barge-in 取消前一响应后继续关闭下一语音回合的响应门。活动响应与未播放输出仍由各自独立的门控制。
- 验收：`tests/engine/duplex/test_session_manager.py` 必须覆盖真实 asyncio 任务已完成但 done callback 尚未运行的窗口，并对 response_bound 与非 response_bound 两种情况断言门状态；运行 duplex 相关 core_model CPU 测试（`tests/engine/duplex` 与 `tests/model_executor/models/qwen3_omni/test_duplex_plugin.py`）确认多轮音频用例不再间歇性失败；
  - `docs/design/fullduplex.md` 同步该门语义。^[PR #9282]

## 决策与踩坑

- [SERV-2e] 禁止：把缺失值补成零、重放 terminal message 后重复加 Counter/Histogram、把已移除 replica 的历史 waiting 值留在总和，或把 `stage_gen_time` 当纯 DiT forward 时间。
- [SERV-2d] 禁止：让 `edit_images()` 丢弃已生成的阶段耗时或峰值内存；只修复 generations 路径，或以 HTTP 成功代替指标字段的传播证明。
- [SERV-3a] 禁止：因为 `artifact_key` 相同就跨模式复用；原始输入已剥离后再让 worker 尝试补算缺失字段。
- [SERV-3b] 禁止：只改 ready 查询而遗漏 mark/discard；只测同模式 cache hit，不测跨模式顺序和 counterfactual failure。
- [SERV-3c] 禁止：raw locator 充当内容 salt；授权前 stat；两次独立 decode/stat；用 client-controlled locator 建无界共享 side table；把完整 base64/路径写日志。
- [SERV-3d] 禁止：diffusion 分支以无配置 connector 加载本地 `file:` URI；只把 allowlist 传到 `MediaConnector` 而遗漏 cache-key metadata gate；每次解析重新构造 connector 并漂移策略。
- [SERV-11a] 禁止：在 INFO 日志中写入原始 `text` 或 `prompt`；无条件输出 DEBUG 用户内容；使用固定预览长度替代请求日志开关；在未配置 `max_log_len` 时输出无界用户输入。
- [VLLM-OMNI-PR9282-DUPLEX-APPEND-GATE] 禁止：仅凭任务仍出现在 `append_tasks` 中（不检查 `task.done()`）就让响应门保持关闭；不得用 sleep、时序假设或削减参数化来掩盖该窗口。
