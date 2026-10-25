# 公开正文按句播放

默认关闭。开启后，公开正文首字经 ACP 即时下发，首个完整短句立即交给 TTS；设备继续使用现有的 audio_chunks 播放，终态不重复全文。它减少完整回答生成期间的等待，不代表模型或识别耗时已经低于三秒。

## 启用

先部署匹配的 bridge、companion、[DSH ACP 增量补丁](../integrations/dsh-acp-stream/README.md) 和 [公开答复插件](../integrations/dsh-public-output/README.md)，再在设备入口配置中设置 `sentence_stream: true`。私密语音转发只 POST 一次 `stream: true`，桥接设置 `CC_VOICE_STREAM=1`；DSH 的语音 overlay 同时开启 ACP streamText 和插件 streamPublic。普通聊天请求不开启。Claude 的既有 /input 流式路径还须配置 agent options 的 voice_stream。

DSH 仍完整隔离第一次原始草稿，只在第二次专用答复请求中，增量发布 conest_public_reply 的 reply 字段。不转发普通草稿、思考或工具参数。模型不提供参数增量时仍需等完整字段；初始草稿等待和 TTS 首包不因此消失。

## 从首句到设备

桥接只从公开 EventText 切句。`。！？!?…` 或换行一到就发布，不再等待下一个字符；没有句末标点的尾句在工具消息边界或终态处理。遇到尖括号、反引号或双中括号，停止后续逐句发布，剩余文字留给完整答复处理。运行回执的 sentences 只追加，最多64句、16KiB；completed 保留完整 text、sentences 与剩余 rest。失败、取消或重启中断清除可播放回执，迟到事件不恢复它。

companion 每0.4秒轮询，核对 request_id、relay_key 与稳定的 agent_session_id，按顺序合成新增句子。重复轮询不重复合成，终态验证完整正文等于 sentences 加 rest，再处理未播尾句。无流式句子时沿用完整答复路径；未知执行结果只查询原回执，不重新 POST。保留当前语音总台、原话字段、设备绑定与远程 ASR 配置。

设备 API 在 synthesizing 阶段即可提供分块；设备网关提前拉取并顺序播放，终态完成后结束音频。普通网页播放器仍可能等待 text 才启动，本开关的设备验收不能代替网页首音验收。

## 失败与限制

已发文字和已播音频无法撤回。公开前缀后，格式错误、正文改写、请求失败或取消停止后续播放，不接上第二条答案，也不伪报完成；有音频的失败轮次标记 speech_incomplete，状态仍为 error。用户停止后不再发布该轮迟到音频。流式模式因此允许用户听到最终失败回答的前半段，应按需启用。

最终回答必须保留已经发布的前缀。Claude 的工具前说明可能不包含在最终消息中，此时转发失败；不能把只在 ACP 验证过的行为推广为所有提供商都支持。音频沿用450字、512块、300秒限制。

## 验证

公开插件回归在首字后暂停补答；ACP 回归在首字后暂停模型，验证请求尚未完成但客户端已收到文字，提交后无全文重放。Go 覆盖切句、工具边界、失败、取消、迟到与上限；Python 覆盖重复回执、尾句、改写、会话变更与失败停止。设备 API 回归在模型回执暂停时取得首段 WAV，验证无需等待 completed。

相关测试：`node --test integrations/dsh-public-output/*.test.mjs`；bridge 内运行 `go test -tags no_web ./core -run 'TestVoice(Relay|Sentence)|Test.*VoiceDesk' -count=1`；companion 内运行 `uv run python -m pytest tests/test_voice_relay_stream.py tests/test_voice_sentence_stream.py tests/test_voice_device_app.py`。真实模型首字、首音耗时和板子连续播放需另行实测。
