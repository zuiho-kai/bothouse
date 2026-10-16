# 多伙伴电脑语音：一次一位

对应 Issue #19，继续 Issue #4 的电脑体验验收。用户选择的第一步是“点名一位回答，可切换伙伴”。本版用页面选择伙伴；口头喊名字自动路由、多人同时说话、自主讨论和插话取消尚未实现。

## 目标、输入、输出、反馈

| 要素 | 本版约定 |
| --- | --- |
| 目标 | 同一台电脑和多位已有伙伴轮流聊，切回原伙伴还能接续它的会话 |
| 输入 | 选择伙伴，录音识别或打字，确认后发送 |
| 输出 | 被选伙伴的真实回答及其配置音色，一次一个任务、一个播放器 |
| 反馈 | 伙伴/会话绑定状态、轮次归属、失败原因、播放完成或停止、共享记录写入结果 |

单 AI 的旧生产链路已有两轮记忆和回答播放实测，但真人麦克风、主观音质和完整跨入口记忆仍需验收。多伙伴源码通过下述分层验证，尚未部署，不能据此宣布多 AI 真人对话全链路已经跑通。

## 用法与配置边界

新增入口仅在明确传入配置与名单时启用，不初始化配置、不自动发现伙伴。原来的单伙伴入口继续兼容。

在 companion/ 目录运行（使用自行准备的独立实例文件）：

~~~sh
uv run python -m voice.multi --config /absolute/path/to/isolated-voice.json --roles /absolute/path/to/voice-roles.json
~~~

名单样例见 [voice-roles.json](../companion/examples/voice-roles.json)。project 必须准确对应桥接已有项目；name 是页面名称；tts_voice 是可选的 Qwen 音色。1至8位，不允许重复 project，必须包含主配置的默认 project。逐伙伴音色仅用于 qwen3，省略时沿用默认音色；系统 say 使用共同默认音色。

本轮没有修改 settings.py（Issue #2 由另一任务负责）。当前 Settings.read 仍有历史默认伙伴限制，默认 project 需为 gge。启动前明确检查 bridge_socket、session_key、port、data_dir、shared_memory_dir、model_path、tts_python、tts_model_path，避免落入旧实例默认路径；不要直接复制旧生产配置启动第二个服务。名单中的全部伙伴共用这个明确频道/session_key，暂不处理多频道、多用户和多设备。

页面“刷新伙伴状态”只查询已有绑定，不发送模型请求。未绑定、后端不支持严格恢复、桥接不可用或原会话忙时不能投递；发送前再检查一次，POST携带预期session_id/agent_session_id；桥接取得会话轮次锁后核对，期间切换绑定会409拒绝，且不登记request ID、不发送。旧客户端省略这对字段仍兼容。显示“已找到原会话”不代表远端 CLI 已成功恢复；真正恢复在发送时完成，失败会明确报错。

每轮固定伙伴、请求编号和音色，响应需与原绑定核对。A→B→A 不会把 B 的播放反馈交给 A。共享记录的每个提交、结束、播放事件都有 project；其他伙伴依旧按需读取，不自动塞入所有人的完整历史，也不把语音正文重复发回 Discord。

每次只处理一轮。模型运行中禁止切换目标；回答完成后可切换，下次发送会停止上一条播放。停止播放仍不代表取消模型任务。TTS 共用一个 worker，每条请求单独携带音色，不需要同时常驻多个语音模型。CosyVoice 未接入，保持 Qwen。

## 为什么需要 ACP 严格恢复

普通 ACP 的旧恢复行为允许 session/load 失败后转 session/new，且把加载时的历史更新也交给输出流。这不满足“同一伙伴继续原会话”。语音使用独立 capability：

1. 活跃会话必须匹配原 ID；冷启动必须声明 loadSession 并成功加载原 ID，失败不新建。
2. ACP v1 标准的 LoadSessionResponse 不要求 sessionId，成功对象确认请求的 ID；如果厂商额外返回了不同 ID，拒绝。null/错误响应拒绝。
3. 加载回放、准备前后和 prompt 响应后的通知不计入新回答；正在回答的更新必须携带原 sessionId。
4. 只有 end_turn 才完成；取消、截断、额度/RPC错误、断线和未知停止原因都不能把部分文本当成功朗读。
5. RPC读取线程在处理 prompt 响应的同一边界关闭更新窗口，避免调用者尚未恢复调度时接收迟到文本。
6. 关闭先取消，再等待读/权限线程及 Send 完成，最后关事件通道。不能用延长超时掩盖发送与关闭竞争。

协议依据：官方 agentclientprotocol/agent-client-protocol 的 schema/v1/schema.json，固定提交 00c5a02d7ab96b9d6aa214002d408ce9d972b4e4。本机保留下载文件，未用模型旧知识猜测 load 响应。

2026-10-16只读初始化探测：Cursor、Grok 声明 loadSession=true；DeepSeek 包装器没有声明该能力。ACP 类型本身不是所有厂商都能冷恢复的证明；不支持的冷恢复会失败，已存活且 ID 匹配的连接可以继续。Claude/Antigravity 的语音严格续接不在本次范围。

## 验证证据与未完成项

- Python自动测试：A→B→A的project、会话、音色、共享记录、播放反馈隔离；名单、忙碌、并发提交、重复编号；错误/错会话回执不播；同一TTS进程逐请求切音色。原单伙伴用例仍保留。
- ACP模拟协议：超过事件缓冲容量的加载回放、不支持/失败/null/错ID时不new、标准无ID成功、错误ID更新、取消/截断/RPC错误/EOF、完成后的迟到通知。
- 关闭竞争回归：新测试在修复前触发 race 和 send on closed channel，修复后 -race 重复50次通过。原始证据为本机 .local/strict-close-before.log 与 strict-close-after.log。
- 真模型：Grok独立合成测试对话，记住随机测试词→关闭进程→strict session/load→正确回忆，ID保持一致。不是生产伙伴会话，也没连接 Discord。客户端stderr出现402/429及标题生成回退警告，最终协议轮次与测试成功；不承诺账号额度稳定。
- 真实浏览器：独立8791端口，使用模拟桥接和4秒静音WAV，检查不可用角色禁录/禁发、忙时锁定、A→B→A、停止后切换、角色音色标签、单播放器。截图留在本机 output/playwright/multi-voice.png。这不是麦克风或自然音色真人验收。
- 真实本机TTS：同一Qwen worker先后生成uncle_fu/serena两段音频，用时7.676秒（含首次加载）/2.603秒，音频时长6.16/5.28秒；仅合成测试，不能当全链路延迟。样本与计时留在本机.local/role-a.wav、role-b.wav、tts-roles-check.log。
- Python完整测试113 passed、1 skipped（真实ASR需显式开启）；首次从根目录运行测试导入失败，按仓库规定切至companion后通过。ACP真实测试在普通Go测试中显式跳过，只有提供环境变量才请求模型。
- 同步PR #18后默认并发Go全量出现删除结果卡片测试失败；根因为状态变更早于异步推送完成，已单独记录Issue #24。独立复核30次通过不消除该失败；本PR没有修改该流程。原日志.local/go-final.log保留，后续CI方式全量另记，不能写成所有运行都成功。
- 最终Go/Python、构建、竞态与CI结果见关联PR；本机记录在 .local/。主分支可能同时收到其他任务提交，合并前需重新检查最新SHA。

显式真模型测试（会调用已登录CLI；不在普通CI自动执行）：

~~~sh
cd bridge
CONEST_ACP_SMOKE_CMD=grok CONEST_ACP_SMOKE_ARGS='agent stdio' go test -tags no_web ./agent/acp -run '^TestStrictResumeRealACP$' -count=1 -timeout=180s -v
~~~

未完成：生产部署、真人麦克风的多伙伴完整闭环、每位伙伴语音↔Discord的双向连续记忆、其他伙伴按需读真实记录、听感与延迟评价、口头点名、插话/取消、硬件。按 Issue #4 继续验收，不能提前关闭该体验Issue。

## 部署与回滚交接

本任务没有重启桥接或替换旧配置。启用需要桥接和语音服务都运行本PR版本，且准备显式名单；只替换前端不会让旧桥接增加ACP能力。后续切换先指定唯一操作人，核对旧版本和备份、所有活跃任务、实例路径，再进行受控切换。回滚时停用多伙伴入口并恢复原单伙伴服务与桥接版本，保留新增共享记录和日志，不清空历史。
