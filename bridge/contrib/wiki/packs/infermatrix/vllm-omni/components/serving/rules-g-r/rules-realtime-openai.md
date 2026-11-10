---
name: rules-realtime-openai
description: OpenAI Realtime 请求与会话规则 SERV-RT-1a–1i 与 VLLM-OMNI-PR8840-RT-CANCEL-CODE：/v1/realtime 的 native duplex 优先级与 query routing、24 kHz PCM16 与 session.update、response 单一终态、history 64 MiB 上限与延迟 truncate、dispatcher import 回环、E2E 客户端 wire protocol、复用 chat preprocessing、preflight 的 skip_mm_cache、resample 与 transcript prefix、response_cancel_not_active
metadata:
  scope: 只收 turn-based OpenAI Realtime 连接层的路由、输入、response 与 history 规则及其代码入口表；model-context 自动截断归 rules-realtime-truncation，worker drain 与 session close 归 rules-session-lifecycle，路由装配归 rules-app-assembly
---
# OpenAI Realtime 请求与会话规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-realtime-openai.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-06；updated: 2026-10-13
- 来源（sources）：PR #7285；PR #8279；PR #8287；PR #8294；PR #8339；PR #8566；PR #8840
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| `/v1/realtime`、duplex query、chat capability admission、旧 Qwen stages | SERV-RT-1a | `entrypoints/openai/api_server.py::realtime_websocket` → `entrypoints/duplex/openai.py::dispatch_realtime_websocket` |
| PCM16、session.update、turn detection | SERV-RT-1b | `entrypoints/openai/realtime/connection.py` 的 audio-format validation、session update 与 input buffer |
| response.cancel、max_output_tokens、terminal event | SERV-RT-1c | `OpenAIFullDuplexConnection._run_response`、`ActiveResponse` |
| history memory、deferred truncate、tools | SERV-RT-1d | `realtime/session.py` 的 history insert/replace → `connection.py` 的 truncate/tool admission |
| generic Realtime、WAV chat input、stage output kind | SERV-RT-1g | `connection.py::_build_full_prompt/_run_response_inner` → `serving_chat.py::_preprocess_chat` |
| preflight、sender cache、replacement response | SERV-RT-1h | `connection.py::_handle_response_create/_truncate_prompt_items` → `_build_full_prompt` |
| resample、audio duration、generic transcript prefix | SERV-RT-1i | `connection.py::_run_response_inner/_truncate_transcript` |

### [SERV-RT-1a] Realtime route 必须保留已配置 native duplex 的优先级

- 触发：修改 `/v1/realtime` 的 query routing、模型 stage 判定或 connection factory。
- 强制：已配置 native duplex handler 时，无 duplex query 或显式 `1/true/on` 继续进入该 engine-owned handler；显式启用 duplex 却未配置 handler 时返回 unsupported error。`0/false/off` 选择 turn-based OpenAI dispatch，duplex server 上同样可用；它共用 engine stages，不能打开 native duplex session 或消耗其 `max_sessions` 槽位。
  - 通用 dispatch 以存在 engine client、chat handler 且非 diffusion 为 admission 条件，非空 model query 必须匹配 served name。仅在保留 `supports_qwen3_omni_realtime` 的旧 Qwen 专属分支时，才校验恰好一个 thinker/talker/code2wav，architecture 从 typed `stage.model_config.model_arch`、角色从 `stage.model_stage` 读取；
  - 不能沿用早期 `stage.engine_args` lookup。该旧分支约束不能成为通用 chat-backed handler 的前提。OpenAI connection 的 buffered input/`response.create` 生命周期与 native continuous duplex 各自维持自己的输入与 response ownership。
- 验收：路由矩阵覆盖 configured/unconfigured handler、缺失/true/false query、完整/缺失 chat capability、diffusion 与错误 model；保留旧 Qwen 分支的 checkout 另测 typed topology、缺失/重复 stage 与其他 architecture；通过 assembled WebSocket 检查正常 turn server 进入 OpenAI connection，分别检查 native 与 OpenAI protocol 的生命周期。
  - 不要求 OpenAI 标准客户端发送自定义 `playback.ack` 才能完成会话。^[PR #7285] ^[PR #8279] ^[PR #8339]

### [SERV-RT-1b] 输入格式、部分 session 更新与 VAD 能力必须显式验证

- 触发：修改 Realtime PCM decode、`session.update`、turn detection 或 buffer admission。
- 强制：只接收当前实现支持的 24 kHz PCM16；base64、偶数字节及单次 append/总 buffer 上限在 decode/写入前验证。部分更新使用 `exclude_unset` 后递归合并；显式 null 是更新，不能当作缺省值忽略。OpenAI connection 当前将 server/semantic VAD 归一为 disabled，native handler 的 VAD 行为由自己的配置决定。
- 验收：覆盖不支持的格式/采样率、坏 base64、奇数字节、append/total overflow、嵌套部分更新及显式 null；已有 configuration 不因无关字段更新而丢失。^[PR #7285]

### [SERV-RT-1c] 每个 response 必须有一次且只有一次真实终态

- 触发：修改 response task 的初次 send、取消、异常路径、token limit 或 final events。
- 强制：用户取消即使发生在初始 output item 发送之前，也以 cancelled/client_cancelled 收尾；terminal-event fence 防止重复终态。`max_tokens` finish 转成 incomplete、原因 `max_output_tokens`；只有未完成且非正常取消的路径才发送 server error，并释放 active response。
- 验收：阻塞首次 send 后取消、生成中取消、disconnect、正常完成、token-limit 和异常分别断言终态类型、次数与 active state 清理；测试取消时序而不依赖固定 sleep。^[PR #7285]

### [SERV-RT-1d] history 写入与延迟 truncate 必须在模型之外保有界和 identity

- 触发：修改 conversation item insert/replace/delete、音频 truncate、history memory 或 tool admission。
- 强制：history insert/replace 候选在写入前检查 64 MiB 上限，不依赖下一次 response.create。当前 response 未产生完整 token IDs 时保存整个 truncate event，含 item/content_index；完成后按同一 item 应用，已删除 item 保持删除。invalid content_index 或超出音频长度的请求先拒绝再修改 history；ack 保持请求的 content_index。
  - 不支持的 MCP tools 在 session 配置过滤，在 response 入口明确拒绝，不执行隐藏 fallback。
- 验收：仅持续插入而不生成也命中 memory cap；覆盖 truncate-before-final、删除后延迟回调、invalid index/end、连续 truncate 最新值及不支持 tools。Qwen prefix 对齐细节归 [[rules-realtime]]（模型规则）。^[PR #7285]
- 共用 worker drain 与 session close 合同见 [[rules-session-lifecycle]]（session lifecycle）；公共路由装配见 [[rules-app-assembly]]（app assembly）。

### [SERV-RT-1e] dispatcher import 不得提前初始化回指它的 OpenAI package

- 触发：移动 duplex dispatcher、OpenAI connection imports 或 API-server package exports。
- 强制：会触发 `openai.__init__`→api_server→duplex.openai 回环的 connection imports 留在对应 WebSocket handler 内；tests patch handler 真正导入的 definition module。
- 验收：独立 process 分别先 import duplex.openai 与 api_server，均完成；再验证两类 WebSocket dispatch，不能以 guard suite collect 成功代替实际路由。^[PR #8287]

### [SERV-RT-1f] Realtime E2E 客户端必须按当前 wire protocol 等待完整 response

- 触发：修改 Qwen3-Omni/OpenAI Realtime replay client、PCM chunking 或终态断言。
- 强制：OpenAI buffered path 按 24 kHz PCM16 算 bytes/ms，session.update 使用 nested session 对象；append 后 commit，再 response.create。消费 audio 的 `delta`、transcript delta/done 的相应字段，记录 audio.done 后继续读到 response.done，再判定整次 response。
  - shared web UI 的 manual turn 等待 session.updated，跨 turn 保持同一 connection/history，reply 播放期间暂停 mic upload，response.done 与实际 playback drain 后再接收下一 turn；manual 不发送 playback.ack，也不继承 native VAD 的 camera/barge-in 行为。native duplex 的输入 fixture 按自身协商/resample 路径处理，不能混用 buffered helper。
- 验收：至少一个非空且偶数字节 audio delta、audio.done 与 response.done 均观测到，sample-rate/chunk duration 与实际输入一致；对 conversation 语义使用合适的 model/task 断言，避免偶发同义词误报协议失败；manual 至少连续两 turn 共用 socket，分别核对 VAD 与 manual 的 query、input rate、camera/ack 和终态处理。^[PR #8294] ^[PR #8339]

### [SERV-RT-1g] 通用 Realtime 必须复用 chat preprocessing 与既有模型输出合同

- 触发：修改 turn-based Realtime prompt、chat handler 注入、工具或 generation 参数。
- 强制：server 维护会话 history；把 instructions、text、function_call/output 与 audio 转成普通 chat messages，经共享 `_preprocess_chat` 使用已配置 template、template kwargs 与 tools。24 kHz PCM16 input 包装成 mono WAV；generation 使用 renderer 的真实 engine input。
  - 复用 chat 的 stage output-kind 修正：MiniCPM-o 4.5 audio 的 llm Stage0 保持 FINAL_ONLY，TTS 保持 DELTA，不能被通用 DELTA 默认覆盖。
- 验收：至少两个不同家族经共享路径连续对话；tools 按模型记录实际验证，不由某模型的成功推断其他模型。核对 WAV header/原始 PCM、configured template/tools 与实际 submitted engine input，并断言 MiniCPM 的 FINAL_ONLY/DELTA。
  - 涉及 duplex dispatch/chat plumbing 时按 CI source dependencies 补齐 MiniCPM duplex 与 Qwen online guards 的结果或明确缺口，CPU stub 和手动对话不能代替这些端到端证据。^[PR #8339]

### [SERV-RT-1h] 预算预检不能污染 sender cache，替换 response 必须在取消后重建输入

- 触发：修改 Realtime prompt budget probe、multimodal cache 或 active response replacement。
- 强制：所有 speculative sizing renders 使用 `skip_mm_cache=True`，预算按 renderer 的 expanded prompt 计；接受后才经正常 sender cache render 最终提交的 engine input。有 active response 时先验证候选，拒绝不取消原 response；接受后 await cancellation，等旧 response 的 history/pending truncate 完成，再重新探测并 render 提交输入。
  - 当前 context cursor 与历史保留遵循 [[rules-realtime-truncation]]（自动截断合同）。
- 验收：记录每次 `_preprocess_chat` 的 skip flag，并用实际 sender/receiver cache 行为覆盖重复 sizing、拒绝后重试与最终提交；检查 submitted prompt 包含取消后截短的历史。单测覆盖 invalid/超预算 replacement 不取消 active response，不能仅凭 fake renderer 计数宣称 cache-safe 或最终 prompt 长度无条件有保证。^[PR #8339] ^[PR #8566]

### [SERV-RT-1i] 通用音频输出与 transcript truncate 必须使用实际输出时长

- 触发：修改 Realtime audio chunk resampling、duration accounting 或 transcript prefix。
- 强制：读取实际模型输出 sample rate，用同一 response 的 stateful resampler 转为 24 kHz PCM16；正常完成时 flush tail，duration 只累计实际允许发送的 audio samples。generic truncate 用 `int(token_count * audio_end_ms / duration_ms)` 估计 prefix；token IDs 或有效 duration 缺失时返回空 prefix。
  - tool-call markup 不发音，其 raw token stream 不作为已剥离 tool 的 transcript 对齐依据。
- 验收：覆盖不同源采样率、多 chunk/tail flush、text-only/tool suppression，断言发送 sample 数与 history duration 一致；覆盖 0/中间/末尾 truncate、缺 token/duration 与 tool responses；已有合法 content_index/audio length 检查先于 history 修改。^[PR #8339]

### [VLLM-OMNI-PR8840-RT-CANCEL-CODE] 迟到/无目标的 response.cancel 必须返回 OpenAI 标准 response_cancel_not_active

- 触发：修改 turn-based `/v1/realtime` 连接层（`vllm_omni/entrypoints/openai/realtime/connection.py`）中 `response.cancel` 的错误码映射、`_handle_response_cancel`，或 realtime error 事件的 code/`event_id` 构造。
- 强制：cancel 与回复结束竞态——无 active response，或 `response_id` 指向非当前 active response——必须以 OpenAI Realtime 的标准错误码 `response_cancel_not_active`（常量 `RESPONSE_CANCEL_NOT_ACTIVE`）发送 error 事件，保留原消息文本并回显触发事件的 `event_id`；mismatch 的 cancel 不得设置 `_response_cancel_event`，也不得影响仍 active 的 response。
- 验收：参数化测试覆盖 active response 为 None 与 response_id 不匹配两种情况，断言 error code 等于 `RESPONSE_CANCEL_NOT_ACTIVE`、回显的 `event_id`、`_response_cancel_event` 未设置，且 active response 原样保留。^[PR #8840]

## 决策与踩坑

- [SERV-RT-1a] 禁止：按模型名把所有 Qwen 请求强行改走 OpenAI connection；因没有旧 Qwen 三 stage 拒绝已配置 chat capability 的其他模型；把 client-driven buffer 宣称为同一 generation 的持续音频输入，或将 turn-based route 的可用性当作 diffusion 支持。
- [SERV-RT-1b] 禁止：把任何输入音频格式静默按 PCM16 解码；因字段未出现就清空旧配置；把保留的 VAD 字段或 session.update acknowledgement 当作 server VAD 已实现。
- [SERV-RT-1c] 禁止：finally 将已取消任务改成 failed；重复发送 response.done；把达到 token limit 当作 completed 成功或丢弃未完成原因。
- [SERV-RT-1d] 禁止：history 无限制增长直到生成时才检查；延迟 truncate 丢失 content_index 或把已删除 item 重新插入；把 shared history storage 绑定某模型的 token/ms 算法。
- [SERV-RT-1e] 禁止：只验证正常 serve 先导入 api_server 的顺序；把 lazy symbol patch 在 dispatcher 顶层造成测试绑定旧 alias。
- [SERV-RT-1f] 禁止：发送旧 final=true commit、用旧 `audio` 字段读 delta、在 audio.done 提前退出，或为每个 manual turn 重开 legacy STT connection 丢失历史；以一次模型自我介绍的固定措辞当作协议验收或将 native VAD 证明转给 buffered OpenAI path。
- [SERV-RT-1g] 禁止：重新硬编码 Qwen audio placeholder/token expansion 或增加专属 topology 作为 generic admission；把共享路由等同于所有模型都支持 tools、所有 modalities 或 native duplex。工具可用性仍受 parser、enable-auto-tool-choice 与模型自身能力约束。
- [SERV-RT-1h] 禁止：向 sender cache 写入从未提交给 receiver 的 speculative audio；复用取消之前的 prompt 丢失已听 transcript prefix；把迭代/后缀探测的 render 数量固定成两次，或恢复旧版通过删除 conversation history 缩短 context 的行为。
- [SERV-RT-1i] 禁止：把旧 Qwen 的固定 383 ms/token 换算应用到通用 handler；丢失 resampler tail、给 text-only/tool-call response 发送音频，或把比例 prefix 当作精确词级音频对齐。
- [VLLM-OMNI-PR8840-RT-CANCEL-CODE] 禁止：把该竞态映射为通用 `invalid_request_error`——Open WebUI 在除 `response_cancel_not_active` 之外的错误码上会直接结束通话，迟到的 cancel 因此丢掉整通语音通话；让无目标的 cancel 取消或篡改当前 active response；丢失 `event_id` 回显。
