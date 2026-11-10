---
name: serving-overview
description: vLLM-Omni Serving 组件总览：源码入口 vllm_omni/entrypoints/（cli、openai、openpi、omni/async_omni）与 vllm_omni/engine/（orchestrator、stage engine core、stage pool/runtime、output processor），duplex 客户端 vllm_omni/clients/，什么时候查 / 不放什么，以及按症状指向 architecture、rules、metrics、fault-isolation、engine lifecycle、session、request input、Realtime 等规则页的导航表
metadata:
  scope: 只收 Serving 组件的入口、职责边界和到各规则页的导航；入口到 engine 的边界与 API route owner 归 serving-architecture，规则组与代码地图归 serving-rules-1
---
# Serving

## 现状

- Duplex 公共客户端：`vllm_omni/clients/`；HTTP/WS 实现位于 `vllm_omni/entrypoints/duplex/`，模型 adapter 留在各模型的 `duplex/` 子目录。
- 主要源码入口：`vllm_omni/entrypoints/`（cli、openai、openpi 及 omni/async_omni 入口）和 `vllm_omni/engine/`（orchestrator、stage engine core、stage pool/runtime、output processor）
- 源码校验：以上路径均已在 `main @ 44d3ae10`（upstream `main` 快照）验证存在
- 主要职责：用户入口、请求解析、在线服务和 engine 边界

### 什么时候查这里

- CLI、HTTP、OpenAI-compatible API 或 offline/online 请求行为不一致。
- 参数在入口处丢失、默认值改变，或请求没有进入预期 engine 路径。

### 不放什么

- 模型内部 attention、checkpoint 或 diffusion 算法问题。
- 通用 API 设计方法；这些放 `general/review/`。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 理解入口到 engine 的边界，选择 unified HTTP/WS endpoint、区分 wire protocol，或确认 PersonaPlex/JoyVL 是否是独立 server | [[serving-architecture]]（architecture 与 API route owner） |
| 根据 PR 描述直达 request contract、stage sampling constraints、streaming format、artifact readiness、factory lifecycle 或 metrics 的规则组与第一批源码 | [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（rules 与代码地图） |
| Prometheus family、pipeline waiting/running gauge、stage/replica snapshot 或 collector lifecycle | [[serving-rules-metrics]]（metrics 生命周期规则）   新增核对：SERV-2g。 |
| upstream launcher shutdown、renderer warmup、多 replica compile-cache 隔离与parsed CLI logging初始化 | [[serving-rules-upstream-compat]]（upstream 兼容规则）   新增核对：SERV-7f、SERV-7e、SERV-7g、SERV-7h。 |
| stage/replica 死亡、request-local failure、readiness/liveness 或驱逐后 cleanup | [[rules-fault-isolation]]（fault-isolation rules）   新增核对：SERV-5u。 |
| batched chat frontend fan-out、choice cardinality、whole-batch error/cancellation | [[rules-batch-chat]]（batch chat rules） |
| engine startup/shutdown、stage lifecycle、acknowledged abort 的 shutdown race、duplex stage prewarm/CFG companion，或 opt-in event-driven orchestration / reader-poller reconcile / final-output drain | [[rules-engine-lifecycle-1]]、[[rules-engine-lifecycle-2]]（engine 生命周期规则） |
| duplex stage-keyed segment state、跨 stage boundary/metadata 隔离与model harness共享有界output buffer | [[rules-duplex-orchestration]]（duplex 编排规则） |
| adapter-owned full-duplex session、deferred cognition/gate、barge-in cancellation、response ownership、`to_thread` worker drain、close/flush/session cleanup，或 startup warmup/realtime admission | [[rules-session-lifecycle]]（session lifecycle 规则）   新增核对：SERV-6j。 |
| acknowledged abort 的 RPC ACK、queue/router shutdown race、cancellation cleanup 或 backpressure/timeout 保持 | [[rules-abort-lifecycle]]（acknowledged abort 生命周期规则） |
| assembled FastAPI route 覆盖、method/path ownership 或 request-body forwarding | [[rules-app-assembly]]（app assembly 规则） |
| stage config→EngineArgs projection、explicit `devices`、TP/local-DP/PP、replica layout 或 worker 创建前的 layout guard | [[rules-stage-startup]]（stage 启动与设备布局规则）   新增核对：SERV-12c、SERV-8b。 |
| 公开请求字段的校验、来源冲突、alias/extras 归一与 consumer view | [[rules-request-input-1]]、[[rules-request-input-2]]（请求输入合同）   新增核对：SERV-4r、SERV-4r2、SERV-4r3、SERV-4r4、SERV-4s、SERV-4r5、SERV-4i2。 |
| speech 输出采样率 capability、resample、streaming header/flush、内部失败 500 与既有异常传播 | [[rules-speech-output]]（speech 输出规则） — SERV-9c、SERV-9d。 |
| OpenAI Realtime routing/capability admission、chat preprocessing、cache-safe preflight、取消后 prompt、PCM16/resample、manual 会话与 transcript truncate | [[rules-realtime-openai]]（Realtime 请求与会话规则） — SERV-RT-1a、SERV-RT-1f、SERV-RT-1g、SERV-RT-1h、SERV-RT-1i。 |

- [[rules-video-stream-prefill]]（Realtime video 增量 prefill 规则） — warmup/abort、窗口身份与已解码帧 snapshot。
- [[rules-sleep-control]]（Sleep/wake ACK 与 admission） — worker/RPC failure、partial-stage recovery 与 stage-ID 预校验。
- [[rules-video-encoding]]（effective video config 与 borrowed RGB eligibility）。
- [[rules-duplex-output-delivery]]（duplex bounded delivery、cancel guard 与creation payload大小）。
- [[rules-voice-management]]（voice删除403/404与typedexceptions）。
- [[rules-control-request-schema]]（sleep/wakeup非空stage_ids与nonnegativelevel）。
- [[rules-realtime-truncation]]（Realtime model-context 自动截断合同）。
- [[rules-multimodal-cache]]（多模态 processor cache 的 replica identity 合同）。
- [[rules-timeline-guides]]（视频 timeline guides 规则）
- [[rules-gradio-pcm]]（vLLM-Omni 服务：Gradio 示例 PCM 音频转换规则）
- [[rules-seed-tts]]（vLLM-Omni Serving：Seed-TTS 基准与准确率规则）
- [[rules-stage-cli-tests]]（vLLM-Omni Stage-CLI 测试规则）
- [[rules-minicpmo-attn-compare]]（vLLM-Omni Serving 规则 — MiniCPM-o 注意力后端对比）
- [[rules-diffusion-speech-params]]（Diffusion speech 采样参数校验规则）
- [[rules-dfx-reliability]]（vLLM-Omni Serving · DFX 可靠性故障注入测试评审规则）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, components, serving；created: 2026-07-10；updated: 2026-10-09
