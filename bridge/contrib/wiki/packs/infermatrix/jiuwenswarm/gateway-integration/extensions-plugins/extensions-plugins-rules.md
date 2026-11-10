---
name: extensions-plugins-rules
description: video_duplex 全双工扩展审查规则 JIUWENSW-I21/I23/I24/I25/I26/I27/I31：检查点 push/ACK 单次、执行 settle、授权 ValueError/RuntimeError、通知超时公式、任务工具同步、委派调度字段、JoyAI 标记与音频采样率
metadata:
  scope: 只收 video_duplex 扩展的审查规则；扩展框架与 registry 归 jiuwenswarm-extensions，video_duplex 文件导览归 jiuwenswarm-extensions-video-duplex，入口导航归 extensions-plugins-overview
---
# video_duplex 全双工扩展审查规则：任务检查点、授权投递与 Provider 协议

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
- [JIUWENSW-I21] 检查点 push/ACK 只走一次：`_pending` 要在推送前注册、在 finally 里清理，任何一侧都不许重试
  - `RemoteTaskEndpoint.call` 必须先把 future 放进 `_pending[command_id]`，再 `await send_runtime_push(...)`。ACK 可能在推送还没返回时就到了。`finally` 里必须 `pop` 并取消还没完成的 future。
  - 每次 `call` 都会生成新的 `command_id`。在调用方或 `call` 里加重试，会绕开 `store.replay` 的去重，`claim` 这类动作就会被执行两次。超时应当直接失败。`handle_checkpoint_push` 在 ACK 发送失败时只记日志，不重做，这一行为要保留。
  - `resolve_checkpoint_ack` 在 `set_result` 之前要核对 `(user_id, session_id, execution_request_id)` 与 `identity` 是否一致。ACK 里的 `execution_request_id` 来自 `chunk.request_id`，改字段名时两端要一起改。
  - `call` 靠 `result.get("error")` 判断失败，所以 `execute` 的成功返回值里不能出现 `error` 键。
  - `_endpoints` 是 `WeakValueDictionary`。endpoint 的生命周期由 `AgentTaskExecutor.endpoint` 这个强引用维持。重构后如果不再持有这个引用，推送会报 `Task Gateway endpoint is unavailable`。
  - `handle_checkpoint_push` 遇到非 `EVENT` 帧必须返回 False，调用方靠这个返回值把帧交给普通消息投递。
- [JIUWENSW-I23] `AgentTaskExecutor.run`：执行未确认 settle 前，既不能返回，也不能抛普通异常
  - 成功路径：`_run` 返回后，如果 `interaction.state` 还是 `pending`，必须抛 `ExecutionUncertain`。如果 `execution_bound` 为真，必须先 `wait_settled` 再返回。
  - 异常路径：已 bind 但 `execution_settled` 还没置位时，必须包装成 `ExecutionUncertain("... no work was replayed")` 抛出，不能让原始异常直接冒出去。这样才能和可以安全重跑的普通失败区分开，避免有副作用的 Agent 工作被重放。
  - `InteractionPending` 分支要先 `wait_settled`，再重新抛出。
  - 产物查询要遍历 `prior_request_ids` 加上当前 `request_id`。某一轮查询失败时只设置 `artifact_lookup_failed`，不能让整个结果失败。
  - 新增的等待必须设上限并转成 `ExecutionUncertain`，参照 `wait_settled` 的 20s。`cancel` 里轮询 `execution_settled` 的循环现在没有上限，改到这里时不要再加类似的无界等待。
- [JIUWENSW-I24] 授权链上 `ValueError` 表示永久失权，瞬时故障必须抛 `RuntimeError`
  - 每个 `handle_*` 和 `start` 都必须先通过 `self.scope`（内部调用 `authorized_scope`）拿到 `(owner, scope)`，然后才能访问 `self.service`。`task-duplex:` 作用域还要通过 AgentServer 的 `SESSION_GET_METADATA` 核对 `user_id == owner`。`handle_answer` 自己拼接 `"task-duplex:" + session_id`，也必须经过 `scope`。
  - 在 `task_identity` 里，空 owner 表示现有的匿名作用域。不要用服务器 OS 用户或其他值去填它。
  - `changed.deliver` 每次事件都会重新授权，捕获到 `ValueError` 就删除订阅，并清理对应的 `_approval_cards`。所以网络或 AgentServer 的瞬时失败必须保持为 `RuntimeError`，像 `task_agent_query` 那样；改成 `ValueError` 会把在线订阅者悄悄踢掉。反过来，身份被否决时必须抛 `ValueError`。
  - `subscribers` 的键是 `(owner, session, id(ws))`，`_approval_cards` 的键是在它后面加 task id。两者的清理条件要保持一致。
- [JIUWENSW-I25] `notification_timeout` 按 `deliver` 的最坏耗时推算，`deliver` 里增减 await 时要同步改公式
  - `TaskService` 的 `notification_timeout=AGENT_QUERY_TIMEOUT + 2 * EVENT_SEND_TIMEOUT + 1` 对应的是：一次 `authorized_scope` 查询（`AGENT_QUERY_TIMEOUT`），加两次 `send_event`（各 `EVENT_SEND_TIMEOUT`）。
  - `deliver` 最后还调用了 `_sync_approval_card`，里面又有一次 `wait_for(..., EVENT_SEND_TIMEOUT)`，公式没把它算进去。在 `deliver` 或 `_sync_approval_card` 里新增 await、或调整这些超时时，要一起修正公式，并确认总耗时没有超出预算。
  - 所有 `channel.send_event` 都必须包在 `asyncio.wait_for(..., EVENT_SEND_TIMEOUT)` 里。不同订阅者之间要用 `gather(..., return_exceptions=True)` 并行投递（注释写明一个慢连接不能占掉其他订阅者的预算），不要改成顺序 await。
  - 只要有任意一个订阅者投递失败，就必须抛 `RuntimeError("Task notification delivery was incomplete")`，不能吞掉。
- [JIUWENSW-I26] 任务管理工具：名字集合、schema、手写类型校验、`operate` 分支四处同步改；冲突按异常类型区分
  - `_TASK_TOOLS` 里的名字必须和 `task_management_tools()` 里的名字一一对应。只在集合里有、specs 里没有的名字，会让 `parse_qwen_omni_tool_call` 的 `next(...)` 抛 `StopIteration`；只在 specs 里有的名字会被当成不支持的工具拒绝。
  - 参数白名单来自 schema 的 `properties`/`required`，但类型校验是手写的：
    - `answers` 只查是否为列表、长度是否在 1–32。
    - `revision`、`offset`、`queue_version` 必须是整数。
    - 其余属性一律当作非空字符串，长度不超过 256（`instruction` 不超过 4000）。
    - `answers` 的元素这里没有校验（schema 里声明的是 string/maxLength 4000）。
  - `VideoSearchManager.operate` 最后的 `else` 按 `jiuwen_task_modify` 处理。新增任务工具必须加显式分支，否则会被当成 modify 执行。
  - 冲突用 `QueueVersionConflict`/`TaskRevisionConflict` 捕获（`errors.py` 声明文案不属于控制协议），不要改成匹配错误字符串。这两个类继承自 `ValueError`，如果前面放了更宽的 `except ValueError`，会把冲突回执吞掉。
- [JIUWENSW-I27] 委派工具的调度字段（`independent`/`depends_on`/`resources`）和兼容字段在多处硬编码
  - `qwen_omni_tools()` 的 schema。
  - `parse_qwen_omni_tool_call` 的排除集合 `set(arguments) - {...}` 和逐项校验。
  - `handle_qwen_tool` 里的 `scheduling` 复制。
  - `AgentTaskExecutor.run` 的上下文选择（`independent` 只带 `depends_on` 的结果，其余情况带最近 6 条）。
  - `public` 的投影。漏改时，新字段要么被当成第二个 task 字段、报 `exactly one task field`，要么被悄悄丢掉。
  - `jiuwen_delegate` 的 schema 只公开 `task`，但解析时仍接受 `_DELEGATE_ARGUMENT_NAMES` 里的旧字段名。旧版 `jiuwen_research` 要求 arguments 里只有 `query` 一个键。`QwenOmniToolCall.query` 是兼容别名。这些都不要删。
  - `handle_qwen_tool` 用字面量 `{"jiuwen_delegate", "jiuwen_research"}` 判断是否委派。改 `QWEN_OMNI_DELEGATE_TOOL_NAME`/`QWEN_OMNI_RESEARCH_TOOL_NAME` 时这里要一起改。
- [JIUWENSW-I31] JoyAI 适配：动作标记与提示词、音频采样率与编码都要成对修改
  - `parse_action` 的判定顺序固定：
    - 先找 delegation 标记，标记之前是 response，之后是 delegation。
    - 然后找 silence，再找 response。
    - 空文本算 silence，没有标记的文本算 response。`_USER_KNOWLEDGE_GUARD` 让模型输出 `</response> 简短说明 </delegation> ...`。改提示词或 `JOYAI_TASK_INSTRUCTIONS` 里的标记格式时，`_RESPONSE_MARKER`/`_SILENCE_MARKER`/`_DELEGATION_MARKER` 和判定顺序要一起改。
  - instruction 为空时，`ground_user_instruction` 必须返回空串，这样纯帧轮次不会带上约束。此时 `request_frame` 用 128 max_tokens，有指令时用 512。工具结果只能放在“已确认的九问工具结果”这个事实段里，不能拼进【用户原话】，以防注入。
  - ASR 的 setup 里 `sample_rate: 16_000` 必须和 `_pcm16_from_wav` 的 `target_rate` 一致，`struct.pack(">iii", -1, 0, 0)` 的帧头也要保留。TTS config 里的 `sample_rate: 24_000` 必须和 `synthesize_channel` 里 `_wav_from_pcm16(pcm, 24_000)` 一致。只改一边会得到变速或失真的音频，而且不会报错。
