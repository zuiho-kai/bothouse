---
name: rules-session-lifecycle
description: "Serving session lifecycle 规则：SERV-6h deferred cognition 不阻塞 input reader、response lock、CUDA worker drain 与 flush / on_close（PR #6537）；SERV-6i duplex startup warmup 经真实 /v1/realtime self WebSocket、120 秒 escape hatch（PR #6354）；SERV-6j 视频预热缓存不回写已逐出帧、取消后不 sleep(0.1)（PR #7363）；SERV-CLIENT-DEFAULTS-1a client 在 session.updated 后才应用默认值（PR #7784）"
metadata:
  scope: 只收 SERV-6h、6i、6j 与 SERV-CLIENT-DEFAULTS-1a；SERV-6a–6f 归 rules-engine-lifecycle-2，SERV-6g、6k 归 rules-duplex-orchestration，Realtime video 增量 prefill（VSP-*）归 rules-video-stream-prefill
---
# Serving session lifecycle 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-session-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-05；updated: 2026-10-09
- 来源（sources）：PR #6537；PR #6354；vllm_omni/config/stage_config.py；vllm_omni/entrypoints/openai/api_server.py；vllm_omni/engine/duplex/adapter.py；vllm_omni/engine/duplex/runtime.py；vllm_omni/experimental/fullduplex/mage_vl/adapter.py；vllm_omni/experimental/fullduplex/mage_vl/serving/backend.py
  - vllm_omni/experimental/fullduplex/mage_vl/serving/server.py；tests/e2e/features/fullduplex/test_mage_vl_adapter.py；tests/e2e/features/fullduplex/test_mage_vl_serving.py；tests/e2e/online_serving/nemotron_voicechat_realtime_duplex.py；PR #7363；PR #7784
- 置信度（confidence）：high
- [SERV-6h] deferred session cognition 必须保持 input responsiveness、response ownership、worker drain 与 cleanup
  - 触发：共享 `DuplexAdapter`/`DuplexRuntime` lifecycle、deferred cognition/gate、full-duplex barge-in、shared-GPU `asyncio.to_thread` inference、disconnect/explicit close 或 session registry teardown 变化。
  - 强制：昂贵的 deferred cognition 必须在 sole input reader 之外运行，完成 watcher 而不是 input consumption 才能发起 response；response start/replacement 通过一个 response lock 串行化，新 response 以 stale epoch 加 cancellation 取代 live response。`response.cancel` 无论有无 in-flight response 都必须 barge-in 并发出 cancelled acknowledgement。
    - 不可取消的 CUDA worker 在 asyncio wrapper cancellation 后仍须在 shield 下等待真实退出，且显式处理 `asyncio.CancelledError`，共享 inference lock 在 drain 前不得释放。deferred task 必须按 session 追踪；barge-in/disconnect cancel 并 drain，explicit graceful close 才调用 `flush(session)`，随后 `on_close(session)` 释放 session state。
    - shared lifecycle hook 必须对旧的 duck-typed adapter 保持 optional/compatible；registry/lifespan close 必须 close runtime 并清空 lease。
  - 验收：two-second synthetic gate 下 `response.cancelled` 在 0.5 seconds 内到达；并发 input/gate completion 不得创建 duplicate response；cancel/disconnect/close 后无 worker/task、registry lease 或 session-state residue；explicit close 可 flush pending gate 再完成 response，disconnect 则 cancel；
    - 没有 lifecycle method 的既有 adapter 行为不变。PR 的 CPU suite 证明 lifecycle contract；报告的 RTX 4090 run 只是 single-run functional evidence，不得外推 throughput、latency 或一般 hardware support。^[PR #6537]
- [SERV-6i] optional duplex startup warmup 必须闭合 readiness、真实 transport 与 shutdown lifecycle
  - 触发：duplex session startup warmup、`warmup_frames` 配置、realtime WebSocket admission，或 API-server shutdown 中的 warmup task 管理。
  - 强制：`warmup_frames=0` 保持禁用；启用时先确认 `/health`，再用标记过的 self WebSocket 连接穿过实际 `/v1/realtime` handler 和生产 session/stage path，完成 configured silent frames 后显式发送 session close。真实 client 在 warmup event 前等待，最多 120 seconds；
    - 无论成功、health timeout、缺 optional client dependency、protocol failure 或异常，warmup coroutine 都必须 set event。失败只记录并继续提供服务；server shutdown 必须 cancel 未完成的 warmup task。
  - 验收：覆盖 disabled、health-then-self-WS ordering、warmup tag 绕过 admission gate、explicit close、success/failure 均 set event、real-client 120-second escape hatch，以及 shutdown cancellation。^[PR #6354]
- [SERV-6j] 视频预热缓存不得在帧被逐出后回写，取消重启不得插入固定延迟
  - 触发：修改 streaming video WebSocket 的 `frame_pil_cache` / prewarm decode、有界 `frame_buffer` 逐出，或 cancel-then-restart 上一 query 后的等待逻辑。
  - 强制：prewarm 完成（成功 PIL 或 `_BAD_FRAME`）写入缓存前，必须再次确认该 b64 仍在当前 `frame_buffer`；已逐出则丢弃结果，不得把帧重新插入 cache。取消上一 query 并 await task/`abort()` 后，不得再 `asyncio.sleep(0.1)`；Orchestrator abort ACK 已是完成信号，墙钟等待不是额外 completion 证明。
  - 验收：`max_frames=1` 下延迟 decode 时，被逐出帧的 PIL 在会话仍打开时可被回收；`max_frames=2` 时仍缓存到 teardown。中断连续 query 时记录的 sleep 请求为空，且旧 generator 关闭与 abort 完成发生在下一次 generate 之前。^[PR #7363]
- [SERV-CLIENT-DEFAULTS-1a] duplex client 只在 session.updated 后应用默认值
  - 触发：修改 duplex client session_info 或 audio format/sample rate/RMS 默认值。
  - 强制：发送 session.update 不预先改本地有效 session；收到 server session.updated 后从确认 payload 更新 flat/nested audio 默认值，失败或 rejected update 保持旧值。
  - 验收：覆盖 accepted/rejected update、flat/nested payload 与 format/sample-rate/RMS，断言发送后到 ACK 前有效默认不变。 ^[PR #7784]

## 决策与踩坑

- [SERV-6h] 禁止：在 reader path await gate/model cognition；copy 一份 model-specific serving loop/runtime；把 wrapper cancellation 当成 GPU worker 已停止；silent no-op `response.cancel`；遗留 gate task/queue/session map；或把 Mage-specific flush/response-on-close policy 施加给 generic adapter。
- [SERV-6i] 禁止：用直接调用 model/adapter 代替实际 tagged WS path；bare WebSocket disconnect 后留下占用 session slot；因 warmup failure 拒绝服务或永久阻塞 real client；或在 shutdown 遗留 background warmup task。
- [SERV-6j] 禁止：让 decode 竞态把已逐出帧钉回 cache 造成会话期泄漏；用固定 sleep 冒充 abort 排空；把去掉 sleep 说成已消除更深的 EngineCore GPU race。
- [SERV-CLIENT-DEFAULTS-1a] 禁止：把未确认 patch 当作有效配置，导致 rejected update 后客户端使用服务器未接受的音频格式。
