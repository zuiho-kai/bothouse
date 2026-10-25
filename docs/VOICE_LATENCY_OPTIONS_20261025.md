# 2026-10-25：板子语音延迟的实测与开源方案

Refs #284。目标是用户说完到板子实际开始出声约 2 秒。本次完成方案调查和隔离实验，未部署；当前证据不能证明端到端达标。

## 决策

优先沿现有 bothouse / DSH / CoNest 链路消除串行等待，参考小智的双向 TTS、Pipecat 的流式管线和 LiveKit 的提前生成机制。先整套迁移框架不会自动消除现有两次模型生成，还会增加设备协议、身份、记忆和工具执行的迁移工作。

应优先验证三件事：

1. 原执行步骤直接提交唯一的公开答复字段，避免“完整原稿→第二次模型生成”成为必经路径。当前仅靠提示词和 JSON mode 的原型未通过稳定性测试，不能上线。
2. 用火山双向 WebSocket 接收公开文字增量、持续返回 PCM；连接提前建立并复用，整轮保留连续 Opus 编码。当前凭据与肥鱼音色已用合成文本跑通该接口。
3. 将识别工作移到用户说话期间，转录稳定后才允许提前准备答复；转录变化即取消。减少 VAD 和轮询等待，必须同时验证不抢话、不截尾、不重复执行工具。

这里的“首字出来就回答”指首个合格的公开文本增量立即送入同一 TTS 会话。TTS 本身仍需要足够的语义和声学上下文，不等于一个汉字到达就能立即从扬声器发声，也不是每个字发一次 HTTP 请求。

## 计时边界

至少记录以下时间：用户最后一个语音采样、网关确认结束、ASR 最终转录、原模型请求开始、首个公开文本增量、TTS 首份 PCM、网关首个 Opus 包、设备扬声器首声。各服务用 request/turn ID 对应，不能把不同轮次的最快值拼成一次端到端结果。

“接口首字”“ACP 首句”“网关首包”“设备实际首声”是不同指标。截图中的约 0.86–1.26 秒不能替代完整链路；本次 TTS 实验没有通过板子播放，也没有声学计时。

现场代码中网关默认 VAD 静音阈值为 800ms；语音侧回执轮询为 400ms，网关输出轮询为 300ms。阈值和轮询不应未经测量就当作每轮固定相加的开销。网关 PRE_BUFFER=15 是可提前发送的窗口，也不能当成固定再等待 900ms。

当前 ASR 配置启用了模型预热。预热不等于边录边识别；要缩短说完以后的时间，需要验证流式输入和最终转录的实际完成时机。

查阅的默认设备配置未显式启用 sentence_stream，代码默认关闭。正式接通时须按每个实际 voice 进程核对配置、角色和 relay 绑定；只有模型端发送增量，不能证明下游已开始提前合成。

## 一次模型生成：已有反例，暂不可发布

核查的生产配置和隔离测试启动器使用同一 provider、model 与 API base：codegoai-deepseek、deepseek-v4.1-flash、api2.dshapi.icu。2026-10-24 更新的配置已生效。此前把慢主要归因于旧 URL 不准确。

额外成本来自公开输出 guard 收完原请求，再请求一次公开答复；第二步是模型生成和字段校验，并非只是几毫秒的本地校验。

独立合成会话保留请求中的 26 个工具 schema，关闭思考，加入 response_format=json_object，并将历史 assistant 纯文本在测试 wire 上一致编码为 reply JSON。它不恢复或回写真实会话，不发 Discord 消息。

| 实验 | 结果 | 限制 |
| --- | --- | --- |
| 三轮算术初筛 | 每轮一次请求；ACP 首句 3085 / 2201 / 1696ms | 只验证无工具问答 |
| 扩大到六类输入 | 前三轮公开首字 3052 / 2418 / 1956ms；第 4 轮含反斜线路径的输入被 invalid_reply 拒绝，后两轮未运行 | 未定位该次拒绝的具体语法原因，不能归因于转义本身 |
| 增加格式诊断后复现 | 第 1 轮通过，首字 3415ms；第 2 轮普通问候已不是合法 JSON，被拒绝 | 说明失败不限于路径输入 |

因此“统一历史格式＋JSON mode”不是当前接口上已证实可靠的约束。不能用少数成功样本宣称已经稳定一次生成，也不能把失败时的普通原稿直接公开。

测试专用转换器把明确要求的 JSON 文本映射到现有公开字段解码器；收到真实执行工具调用就停止。保留工具 schema 只说明没有从请求删掉工具，不代表已验证工具功能。完整实现仍须验证执行工具、多轮历史、恢复、取消、超时、混合输出和流中断。

历史格式需要在正确的模型消息投影边界实现；agent/request 返回的是 LlmCallConfig，不包含 messages。DSH 的 agent-loop 在 packages/core/agent-loop/src/agent.ts 中从 session.deriveMessages() 得到冻结历史，Session 另有可持久化消息投影机制。不能把实验用全局 fetch 修改直接变成生产实现，也不能改写历史执行工具或保留已失效的 provider replayState。

### 一次生成的后续定位

关闭实时公开并完整收集后复现路径用例：原始 SSE 32字符、DONE 到达、finish_reason=stop，JSON不能解析；适配器累计delta与最终text均为32字符且一致。排除了该轮由适配器截断或丢字符造成的解释。实时guard拒绝非法转义时会取消源，不能把这种取消误判为供应商截断。

公开原文标记能保留路径，但未增加本轮日志说明时第二轮问候即漏标记；增加producer-owned本轮日志说明后，前四轮通过，第五轮历史追问又漏标记。前四轮ACP公开首字约2.5–3.5秒，仍不是端到端2秒。格式失败明确结束，没有第二次补答，不能将这些样本写成可靠实现。

同中转、模型和凭据的最小接口能力测试，以唯一字符串枚举schema-constant为约束，用户只问合成算术，不带真实历史或执行工具：

| 请求约束 | 实际结果 |
| --- | --- |
| Chat Completions：response_format=json_schema，strict=true | 普通正文3字符、零工具、stop，未满足schema；首字3969ms |
| Chat Completions：工具strict=true、tool_choice=required | 普通正文3字符、零工具、stop；首字4194ms |
| 同中转Messages：tool_choice=any | 普通正文3字符、零工具、end_turn；首块3565ms |
| 同中转Responses：strict工具schema、tool_choice=required | 普通正文3字符、零工具、completed，未执行强制工具选择；首块4649ms |
| 同中转Responses：text.format=json_schema、strict=true | 普通正文3字符、零工具、completed，未满足schema；首字4001ms |
| 同中转/beta/chat/completions：strict工具schema、tool_choice=required | HTTP 200、text/html，不是事件流；不能作为可用模型接口 |

DeepSeek官方文档将strict工具模式限定在官方/beta地址，并列出Responses的工具选择和text.format支持；因此补测同中转的这两条协议路径。官方支持不代表中转会转发或执行同一能力。出处：[strict工具模式](https://api-docs.deepseek.com/guides/tool_calls)、[Responses协议](https://api-docs.deepseek.com/guides/responses_api)。请求均使用同域名、同模型、同凭据和合成输入，没有更换生产路由。

这些请求没有执行所指定的强制约束，不证明其他接口、模型或供应商均不支持。继续重复提示词、补标签或修复无效JSON不能提供可靠公开边界。下一步先在提供商修复后的接口或其他明确支持约束的接口验证，保留肥鱼人设、原历史及执行工具，再决定是否接正式历史投影。一次生成原型不可发布。

适配器另加缺失schema回归：singlePass已开启但请求没带公开schema时，原生成和补答计数都必须为零。修复前该测试在原生成计数1处失败；修复后在请求前明确终止，不因组装失败走回第二次生成。默认旧模式的补答schema描述保持不变。

## 同音色 TTS：已完成真实接口对照

独立合成文本为：“你好，我是语音测试助手。这是一段独立的合成测试。我们正在测量首段声音的等待时间。”没有播放、保存录音或提交凭据。

肥鱼角色配置实际使用 zh_female_sajiaoxuemei_uranus_bigtts；两种接口都使用该音色、seed-tts-2.0、24kHz 单声道 PCM。HTTP 通过仓库真实 VolcTTS.synthesize_stream 实现运行；观察器仅记录首次含音频的数据行和回调时间。WebSocket 是独立实验客户端，参考官方二进制事件协议，未接入生产。

HTTP 与 WebSocket-full 交替各跑三轮。HTTP 复用同一 httpx.Client；WebSocket 复用同一连接，各轮等 SessionFinished 后再开新 session。该连接首次建立和 StartConnection 确认耗时 573ms，下面的 WebSocket 单轮数据不含这次建连，包含 StartSession 确认。

| 单轮请求/会话启动到指标，ms | 第 1 轮 | 第 2 轮 | 第 3 轮 |
| --- | ---: | ---: | ---: |
| HTTP 首份 PCM | 583 | 480 | 504 |
| HTTP 现有首块回调（0.6 秒音频） | 683 | 498 | 597 |
| WebSocket 整段输入首份 PCM | 451 | 413 | 349 |
| WebSocket 整段输入攒够 0.6 秒音频 | 493 | 442 | 453 |
| WebSocket 分三句输入首份 PCM | 318 | 350 | 456 |
| WebSocket 分三句输入攒够 0.6 秒音频 | 677 | 663 | 658 |

三句输入间隔为 350ms，最后一句约在首句发送后 703–705ms 发完；三轮都在最后一句发送前收到音频。每轮均收到正常 SessionFinished 和非空 PCM，证明当前账号、资源和音色能完成双向合成。

HTTP 当前攒够 0.6 秒音频的实际额外等待为 100 / 18 / 93ms，而不是固定 600ms。不能按音频时长估算墙钟节省。整段输入、相同 0.6 秒缓冲下，本小样本 WebSocket 首块比 HTTP 快 190 / 56 / 144ms；其更重要的能力是与模型剩余文字生成重叠。

再做三轮逐字输入，每个字间隔 35ms：

| 指标，ms | 第 1 轮 | 第 2 轮 | 第 3 轮 |
| --- | ---: | ---: | ---: |
| 首字发送到第一句发送完成 | 405 | 406 | 406 |
| 首字发送到首份 PCM | 730 | 653 | 686 |
| 首字发送到攒够 0.6 秒音频 | 1143 | 1040 | 1133 |
| 全部文字发送完成 | 1435 | 1440 | 1440 |

这三轮也都在全文发送完以前收到音频，但没有达到“首字一到立刻出声”。逐字测试刻意改变了文字供应速度，不能把它和整句立即可用的实验作单因素速度比较。

WebSocket 若先提供 120ms 音频即可交给下游，以上实验都能在首份 PCM 时跨过该阈值。但当前尚未验证小首块经过网关后的连续播放；不能直接缩小整个播放缓冲，导致已经解决的断音再次出现。

每种情况只有三轮，不足以给出 p95、抗网络抖动或稳定节省量。WebSocket 冷建连、长期闲置重连、取消确认、并发串行化和板端播放仍需验证。

### 仓库双向TTS客户端：接口通过，应用未接入

新增 companion/voice/volc_bidirectional.py，异步迭代文字边送边收WAV，同资源连接顺序复用；只有完整成功后复用。取消或任何失败发送取消请求并关闭连接，不以取消确认作为复用前提，旧socket迟到音频不转入新轮。保留0.6秒音频回调、500字输入和300秒音频上限，不改网关Opus编码。websockets列为显式依赖，锁文件保留原有17.2版本。

使用仓库客户端、websockets17.2和肥鱼当前音色，再跑三轮逐字输入，间隔35ms。预建连280ms另计；单轮从调用客户端开始计时，包含StartSession确认：

| 指标，ms | 第1轮 | 第2轮 | 第3轮 |
| --- | ---: | ---: | ---: |
| 首份WAV回调（保留0.6秒音频块） | 1176 | 1152 | 1076 |
| 全部文字送完 | 1474 | 1469 | 1469 |
| 完整会话完成 | 2948 | 2883 | 2921 |

各轮在全文送完前获得非空音频并正常完成；另一次实际中途取消后重新建连合成成功，旧轮回调数没有再增加。不播放、不保存音频。此处不是板子或扬声器首声测量，也不能与使用不同计时起点的前表直接比较。

本地WebSocket服务器13项覆盖文字/音频重叠、成功复用、并发串行、取消后迟到帧、文字源/回调失败、跨会话音频、奇数字节PCM、空音频、错误终态、畸形帧、超时与累计上限。应用尚未实例化客户端；relay仍按完整句发布，公开token到同一TTS会话的完整接线待做，不能把客户端通过当作第二阶段落地。

## 开源方案比较

| 方案 | 当前框架许可 | 可复用的机制 | 本项目采用方式 |
| --- | --- | --- | --- |
| 小智后端 xiaozhi-esp32-server | MIT | ESP32 协议、文字/音频队列、火山双向 TTS、取消和连接复用 | 最贴近现有设备，优先参考双向 TTS 生命周期；保留本项目整轮连续 Opus 编码 |
| Pipecat | BSD-2-Clause | 增量 frame 管线、TTS 聚合策略、语音前台与任务 agent 的分工 | 借鉴文字到音频的流式传递；整套替换暂不划算 |
| LiveKit Agents | Apache-2.0 | 端点检测、提前 LLM/TTS、转录变化后的取消和观测 | 借鉴时序和取消机制；不假设框架许可覆盖每个模型或云服务 |

Pipecat 文档区分句子聚合与 TOKEN 模式。后者需要 TTS 服务支持流式文字输入；不能对当前一次提交文本的 HTTP 接口简单逐字调用。

LiveKit 文档说明提前生成可以与端点确认重叠，也说明它不一定降低实际延迟。部分当前推荐能力涉及云模型或单独计费，不能把示例默认配置当成现成免费、离线、适合中文的方案。

开源代码固定到本次查阅提交，避免 main 漂移影响复核：

| 仓库 | 查阅 SHA | 直接相关源码 / 许可 |
| --- | --- | --- |
| xinnan-tech/xiaozhi-esp32-server | 9bd668aebc733d77c95d8aa5fb1d25090a772509 | [火山双流实现](https://github.com/xinnan-tech/xiaozhi-esp32-server/blob/9bd668aebc733d77c95d8aa5fb1d25090a772509/main/xiaozhi-server/core/providers/tts/huoshan_double_stream.py)、[文字切分与音频队列](https://github.com/xinnan-tech/xiaozhi-esp32-server/blob/9bd668aebc733d77c95d8aa5fb1d25090a772509/main/xiaozhi-server/core/providers/tts/base.py)、[MIT](https://github.com/xinnan-tech/xiaozhi-esp32-server/blob/9bd668aebc733d77c95d8aa5fb1d25090a772509/LICENSE) |
| pipecat-ai/pipecat | 60999e29fa1e6c890f4beb46f50950a5464ac1cf | [TTS service](https://github.com/pipecat-ai/pipecat/blob/60999e29fa1e6c890f4beb46f50950a5464ac1cf/src/pipecat/services/tts_service.py)、[BSD-2-Clause](https://github.com/pipecat-ai/pipecat/blob/60999e29fa1e6c890f4beb46f50950a5464ac1cf/LICENSE) |
| livekit/agents | 8b4cb4ec4bb45e5cc9d61bd1afbba1584810a0dc | [agent activity](https://github.com/livekit/agents/blob/8b4cb4ec4bb45e5cc9d61bd1afbba1584810a0dc/livekit-agents/livekit/agents/voice/agent_activity.py)、[Apache-2.0](https://github.com/livekit/agents/blob/8b4cb4ec4bb45e5cc9d61bd1afbba1584810a0dc/LICENSE) |

一手文档：[火山双向流式](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-text-to-speech-websocket?lang=zh)、[火山 HTTP 单向流式](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)、[火山连接/session 最佳实践](https://docs.volcengine.com/docs/DoubaoVoice/WebSocketBidirectionalStreaming-V3?lang=en)、[Pipecat TTS](https://docs.pipecat.ai/pipecat/learn/text-to-speech)、[Pipecat 多 agent](https://docs.pipecat.ai/pipecat/learn/multiple-llm-agents)、[LiveKit 时序调优](https://docs.livekit.io/agents/logic/turns/tuning/)。

## 最短落地顺序与通过条件

1. 先修原步骤公开输出契约。通过无工具、真实隔离工具、多轮历史、恢复与取消回归；模型请求计数证明普通问答只有一次，失败仍准确报告。已播出的前缀不能在完成时被改写；不得公开普通草稿或思考，不得重跑已执行工具。当前未通过。
2. 接通双向 TTS，采用同一会话持续收公开文字和输出音频。建连提前、文字结束及时 FinishSession、收到终态再复用；按 turn ID 取消并丢弃迟到音频。先验证整轮连续编码和短首块，不以重设 PRE_BUFFER 替代测量。接口可行性已通过，生产实现未完成。
3. 接流式 ASR 和端点优化，分别统计结束检测与识别尾延迟。提前生成不能提前执行有副作用的工具；转录变化先取消，确认用户本轮输入后才派发工具。用含停顿、连续补充、背景声的语料检查误截断。当前未实现。
4. 若同模型在真实上下文下首个公开增量仍接近或超过 2 秒，再评估上下文、请求组装、常驻连接或语音前台/任务后台架构；不能悄悄换人格、丢记忆或取消工具来满足数字。
5. 最后在板子测用户最后采样到扬声器首声，并同时记录成功率、取消行为及连续播放。PR/CI/审核通过后只从 main 构建发布；#284 在该验收完成前保持未关闭。

## 本地证据与变更边界

私有实验目录为 ~/.cc-connect-maomao/maintenance/voice-stream-20261025/。可复核的合成计时文件包括 onepass-acceptance.log、onepass-diagnosis.log、latency-json-history-direct.json、tts-stream-probe.json、tts-token-probe.json；后两者只含数字、枚举与依赖版本。诊断汇总保存在追加日志中，仅提取固定 probe 前缀，不整体输出日志。

TTS 探针为 tts-stream-probe.py，通过 uv 临时环境使用 httpx 0.28.1 / websockets 15.0.1；--tokens-only 运行逐字实验。探针从本机私密配置读取凭据，不打印认证头、响应正文或连接标识，不保存音频，不运行下载的开源代码。

本轮开发包含一次生成实验、显式公开字段解析器、独立双向TTS客户端和回归；生产发布、运行配置、进程均未改变。一次生成与完整双向TTS接线均未达到发布条件，草稿PR保留阻塞，未合并或部署，未做板子声学验收。私有证据新增schema-capability-probe.log、messages-capability-probe.log、onepass-diagnosis-complete.log、onepass-envelope-logged-owned.log和tts-candidate-probe.json，均不能代替板子首声验收。

最终本机验证：公开输出插件带真实DSH运行时契约102通过、0失败、0跳过；companion 492通过、3跳过；播放器34通过。3项跳过为缺少playwright的两项浏览器测试和显式可选的本地模型/系统发音测试。独立双向TTS的13项包含在companion全量中。DSH本轮build:check为2通过、0失败、0跳过。新增协议探针证据为alternate-protocol-capability.log和beta-protocol-type.log，仅含白名单统计。未重跑本机Go全量：本轮未改Go，既有测试会删除临时目录，与用户目录保护约束冲突；不能把此前结果写成本轮验收。
