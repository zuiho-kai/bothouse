# 语音：ACP 会话常驻与分段耗时（A，工作模式）

Refs #284。范围：bothouse `bridge/` 的私密语音 relay 与 ACP 会话生命周期。
不改 DSH、companion、设备绑定与固件；不动生产进程与配置。

## 目标口径

| 模式 | 从用户说完到第一句有效回答出声 |
|---|---|
| 陪伴模式 | ≤ 2s（B 负责，本文件不评估） |
| 工作模式 | ≤ 4s（本文件负责验收） |

- 「第一句有效回答」指公开答复的首个可播句，不含「收到」类即时应答与提示音。
- 达标只看真机实测分布，不把估计、接口首字、ACP 首句、网关首包当成用户听到的首声。
- 至少要能分开记录：ASR 出字、提交、ACP 启动（spawn+initialize+resume）、首个事件、首个完整公开句、TTS 首包、网关首包、设备首声。缺的段如实写缺。

## 本次实现

1. **按 relay key 的 ACP 会话常驻**（`bridge/core/relay_voice_pool.go`）
   - 池键沿用现有 `relay_key = digest(from, to, session_key, scope)`，因此不同设备、不同角色、不同会话天然隔离，不会串话。
   - 命中条件：`Alive()`、会话 id 与已记录 id 一致、未超 TTL、未超轮数；否则丢弃并严格 resume 重建，不静默新建。
   - 回收：空闲 TTL（默认 600s）、累计轮数（默认 30）、`Alive()` 为 false、取消/失败/看门狗超时。`Close` 一律异步，最多 8s，不挡下一轮。
   - 开关：`[relay] voice_resident = false`（默认关，按设备灰度）；`voice_resident_idle_secs`、`voice_resident_max_turns` 可覆盖默认。
   - 关掉开关时行为与改动前完全一致（每轮新建并 Close）。
2. **失活与卡死恢复**
   - 复用前查 `Alive()`；不活就丢弃重建（strict resume，不静默新会话）。
   - 首事件看门狗 `15s`（来源：调研 A 3.5；首 token 3.7–4.9s 的约 3 倍余量）：超时取消本轮、异步 Close、移出池，回执写明确的 `no first event before watchdog`，不重投。
3. **取消与资源释放**
   - `POST /relay/voice/{id}/cancel` → ctx 取消 → 本轮会话不回收、异步 Close、回执清空 `sentences`，下一轮重建，不会把旧音频或半截上下文带过去。
4. **分段耗时**（`stream=true` 的回执新增 `timings`，非流式回执形状不变）
   - `resident`、`start_ms`（spawn+initialize+resume；命中常驻时为 0）、`first_event_ms`、`first_sentence_ms`、`total_ms`，均相对本轮提交。
   - 每轮另打一条 INFO `voice relay turn`，字段同上，供生产按 P50/P90 统计。

## 与 ACP 增量的关系（依赖现成 PR #288）

只做常驻只能省 ACP 启动的 0.6–1.3s/轮（调研 A 3.5 的隔离实测），**不足以把 15s 级等待压到 4s**。
首句提前必须在模型出字时就发布增量，链路是：DSH `agent/assistant-stream` → ACP `agent_message_chunk` → relay 分句 → TTS 首句。

本机核对结果（只读）：

- 已安装 `@deepseek-ai/dsh-acp` 0.1.5-rc.3 与仓库钉住的 0.2.1-rc.2，`onSessionEvent` 都只处理已提交的 `assistant/message`，没有消费 `agent/assistant-stream`；因此每个 assistant 消息只在整条提交后发一次 `agent_message_chunk`。
- DSH 的 v4 会话日志事件类型中也没有增量事件（只有 `assistant/message`）；`dsh-headless` 只把 reasoning 增量写到 stderr。
- bothouse 侧 `relay_voice.go` 已把 `EventText` 增量喂给 `voiceSentenceSplitter`，`bridge/core/relay_voice_stream_test.go` 已覆盖首句发布；即桥接消费端不需要改，缺的是 ACP 产出端。

这部分已由 open draft PR #288 的 `integrations/dsh-acp-stream/source.patch` 实现（给 DSH ACP 增加 `streamText`），本次不重复实现、也不改 DSH 安装。
在 DSH 未打该补丁并重建之前，工作模式的 4s 目标**不能**由常驻单独达成。

## 验收方法与当前证据

固定短句连测 ≥3 次，分别记录上面的 8 个时间点，报告分布、样本数与条件（冷/热会话、是否常驻、是否开 `streamText`、模型/线路）。

已完成的离线验证（本次，`go test -race ./core/ -run TestVoice`）：

- 同 key 两轮只启动 1 次 ACP，第二轮 `resident=true`、`start_ms=0`；
- 不同 key 不共享会话；
- 会话不 `Alive()` 时重建并 Close 旧会话；
- 累计轮数与空闲 TTL 到期回收；
- 取消后池中会话为 0（无旧音频/旧上下文）；
- 首事件看门狗超时后回执失败并移出池；
- 关闭开关时每轮新建；
- 非流式回执六字段形状不变（原有回归）。

**尚未完成**：真实 DSH + 真机端到端 4s 验收。本文件不声称达标；需要先应用 #288 的 DSH 补丁并重建、按设备灰度打开 `voice_resident`，再按上表实测。

## 风险与回滚

- 每个常驻 ACP 约 130–175MB（调研 A 3.5 实测 footprint）；本实现只按 relay key 常驻，不按角色/设备全量常驻。
- 常驻会话上下文变长会拖慢首 token：靠 TTL 与轮数回收。
- 桥接重启后池为空，`voice_relay.json` 里的会话 id 仍在，下一轮 strict resume；resume 失败按现有 fail-closed 处理，不重投。
- 回滚：`voice_resident = false`（或删掉该行）即恢复每轮新建；无需迁移存储。
