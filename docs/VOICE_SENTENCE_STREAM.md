# 按句语音与识别计时（#130，实验开关）

缩短模型首句已写完到开始合成的等待。默认关闭；部署状态与真机时延记录在对应 Issue/PR，单元测试不能证明真机已达标。

## 启用与协议

先部署匹配的桥接和 companion，再在 Claude agent options 加 `voice_stream = true`、在 8796 私密配置加 `"sentence_stream": true`。Claude 的 `--include-partial-messages` 放进内层参数，兼容 cmd_args_flag 包装器；配置快照保留开关。提供商是否实际发出增量须在隔离会话验收。

语音入口向原 /input 只提交一次，附 stream:true 和原会话双 ID。GET 回执增加累计 speech_text（上限 16KiB），只收显式 text block，不收 thinking/tool block。普通聊天和历史仍由完整消息维护，不重复向频道发增量。每次轮询核对 request_id、session_id、agent_session_id；重试不得更改 stream 模式。

companion 每 0.4 秒轮询，将完整句子交给顺序 TTS 队列，同时继续等待原请求。复用 audio_chunks 接口和单调索引，最终 WAV 合并 PCM。限制 450 字、64 句、512 音频块、300 秒；停止后丢弃迟到合成回调。不另发模型请求，不换会话。

## 私密 relay（#284）

角色配置 `relay_project` 时，companion 通过私密 relay 的 `stream: true` 提交一次。running 回执携带累计 `sentences`，completed 回执携带完整 `text` 和未播尾部 `rest`；仅公开 EventText 可切句，思考和工具结果不参与。纯空白片段保留在回执中以保证与最终正文前缀相等，但不交给语音合成。

companion 校验 request_id、relay_key 和稳定的 agent_session_id；重复轮询不重播。首句合成后设备即可取 audio_chunks，无需等待模型终态。取消或失败停止后续片段，已播出时标记 speech_incomplete。带标签的尾部等最终回答按既有朗读规则处理。DSH 部署须同时采用 [公开插件与 ACP 配置](../integrations/dsh-acp-stream/README.md)；`CC_VOICE_STREAM` 只作用于当前私密 relay 进程。

## 边界

- 已播出的句子无法撤回。后续任务失败仍标失败，不能把出过声当成完成。
- 最终回答必须保留增量前缀；若后端改写，或中间说明不包含在最终回答中，停止并提示核对文字，不拼接两个版本。
- 遇到尖括号、代码反引号、双中括号时停止后续增量朗读，完整回执保留文字。
- 后端无增量时回退到既有完整回答路径。老桥接拒绝新字段时不得自动重新 POST。
- 部署必须保留既有严格续聊、设备绑定与 TTS 配置；只打开流式开关不代表供应商真的增量返回。

## ASR 计时

设备识别接口新增每次调用独立的 timings：audio_ms、validation_ms、queue_ms、setup_ms、inference_ms、total_ms。inference_ms 包含 MLX 首次懒加载，不能当作纯推理时间。模型、识别参数和原文本接口不变。

用相同短音频比较冷启动、重复热运行，区分排队与推理后，再决定预热、换模型或流式识别。目前没有真实录音基准，不能承诺五秒已缩短。

`asr_remote_url` 为空时使用本机模型；配置 HTTP(S) 识别服务时，上传经音量和格式检查的 WAV，接收 text 与可选 inference_ms。`asr_remote_timeout_s` 默认3秒；远程失败回退本机并退避60秒，避免每轮等待同一个故障接口。已有3060服务可保持原地址。服务端参考 `companion/tools/remote_asr_server.py`，仅绑定受控地址。诊断 `VOICE_ASR_DIAG` 默认关闭，只记录计时与资源用量，不记录音频、识别文本或凭据。

## 验证

- 离线端到端：模拟桥接直到首句合成才返回终态；重复轮询不重复说、尾句不丢、跨会话拒绝、失败、停止、无增量回退、标记文本与迟到回调。
- Claude 参数构造使用本地 argv 夹具：开关与普通 CLI/包装器组合验证，无模型调用。
- 核心事件测试：当前会话公开增量进入原请求，不进入普通平台；关闭开关不收集。
- 真实语音仍需测首句延迟、整段完成、连续轮次、中途停止及动画同时运行，不以模拟计时替代。
