---
name: rules-realtime-conformance
description: vllm-omni /v1/realtime WebSocket 一致性评审规则 VLLM-OMNI-PR8258-REALTIME-CONFORMANCE：Qwen3-Omni 两个回归测试（session.created 先于首个 session.updated、空 input_audio_buffer.commit 返回含 empty 的 error）及其复用 omni_server、H100/MI325 双卡标记要求
metadata:
  scope: "只收 PR #8258 一条 realtime 一致性回归规则；其他 vllm-omni 仓库级门禁归 vllm-omni-rules-1 至 vllm-omni-rules-3"
---
# vllm-omni /v1/realtime WebSocket 一致性评审规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/rules-realtime-conformance.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #8258
- [VLLM-OMNI-PR8258-REALTIME-CONFORMANCE] /v1/realtime WebSocket 一致性回归：created 先于首个 updated 与空 commit 报错
  - 触发：改动 Qwen3-Omni `/v1/realtime` WebSocket 协议行为——`session.created` / `session.updated` 事件的产生、顺序或 `session` 对象字段，
    - 或 `input_audio_buffer.commit` 对空音频缓冲的处理——或改动 `tests/entrypoints/openai_api/test_qwen3_omni_realtime_websocket.py` 中 `TestQwen3OmniRealtimeWebSocket` 的协议一致性测试（`test_session_lifecycle_events`、`test_empty_commit_returns_error`）及其 `_conformance_recv_until` / `_conformance_events_of_type` /
    - `_conformance_open_session` 辅助函数。
  - 强制：`test_session_lifecycle_events` 的断言范围仅是截至首个 `session.updated`（含）的事件前缀——`_conformance_open_session` 发送 `session.update` 后按谓词驱动收集，见到首个 `session.updated` 即停止：该前缀内恰好一个 `session.created`、首个 `session.updated` 确已到达、`session.created` 的索引先于 `session.updated`，
    - 且该 `session.created` 携带的 `session` 对象含 `id` 字段；首个 `session.updated` 之后的事件不在此回归的可见范围内，不得据此把断言表述为整个连接期间两类事件各恰好一次。`test_empty_commit_returns_error`：未发送任何音频即提交 `input_audio_buffer.commit` 时，服务端须在 30 秒内返回 `error` 事件且其内容（小写化后）包含 "empty"。
    - 一致性用例必须复用类级共享 `omni_server` fixture（`realtime_async_chunk_server_params` indirect 参数化）连接既有服务器，不得为用例另起服务；事件收集须为带超时的谓词驱动循环（一般路径默认 120 秒），跳过二进制帧，途中收到 `server_error` 类型错误立即以 AssertionError 失败而非等超时。
  - 验收：在 H100/MI325 双卡环境 `pytest tests/entrypoints/openai_api/test_qwen3_omni_realtime_websocket.py::TestQwen3OmniRealtimeWebSocket -k "lifecycle or empty_commit" --run-level=advanced_model` 通过；两测试仍带 `advanced_model`、`omni` 标记与上述 `hardware_test` 声明。^[PR #8258]

## 决策与踩坑

- [VLLM-OMNI-PR8258-REALTIME-CONFORMANCE] 禁止：删除这两个回归或放宽其断言（放弃前缀内“恰好一个 `session.created`”、created 先于 updated 的次序核对、`session` 对象 `id` 字段核对或 "empty" 文案核对）；为单条一致性用例新起独立服务器实例；去掉 `advanced_model` / `omni` 标记或 `hardware_test(res={"cuda": "H100", "rocm": "MI325"}, num_cards=2)` 硬件门槛使回归在错误硬件层被跳过或静默通过；
  - 把等待循环改成无超时的裸 `recv()`。
