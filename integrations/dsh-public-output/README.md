# DSH 公开答复出口

Issue #145。仅在需要阻止执行过程直接进入聊天正文的 ACP 部署上启用。使用 DSH 的 llm/stream 插件接口，不修改 node_modules，也不改模型身份或原会话。

## 为什么需要这一层

上游可能把思考放入普通 content；思考里还可能引用闭标签。因此“找到闭标签后放行剩余内容”没有可靠的公开边界。当前 DSH 0.1.5-rc.3 的 ACP 忠实地将 native text 转为普通正文，问题已经发生在它之前。

- 有工具调用的模型步骤：保留工具 ID/名称/参数，将普通 text 归入 native reasoning；Discord 须关闭 thinking_messages 与 tool_messages。不改变工具调用次数。
- 无工具的成功终态：原始草稿不公开。使用原对话和已发生的工具结果，额外发起一个仅带答复数据 schema 的请求；去掉 reasoning 和带私密标记的历史 assistant text，保留相关工具调用/结果。
- 可选 directReply 在原始请求组装时加入同一公开答复 schema。原始响应已有合法公开字段时直接结束，省去额外生成；否则沿用上述两次有界补答，不能把普通正文当公开答案。默认关闭。
- 只接收唯一 conest_public_reply 调用的 reply 参数；它不注册到工具执行器。严格 JSON 正文仅作兼容接收。reply 字段通过非空、长度及私密标记检查后才进入 native text。原始 SSE 和补答的 reasoning 从不直接发布。已有精确 NO_REPLY 保持静默。
- 补答最多两次格式尝试，共用60秒期限；补答的网络/取消/非成功终态不重试。原请求失败交回 DSH 既有的有限恢复策略（见 #189）。补答的专用数据调用仅在本插件内解析并转为 Text；其他工具、多个调用、不完整调用一律拒绝，任何补答调用都不交给工具执行器。失败有明确错误，不用旧草稿兜底。
- 收集按块索引的首次出现顺序组装，支持 text/reasoning 的 delta-only 流；工具须有完整 block-end，重复块结束或重复工具 ID 整步失败，不重复派发。终态仍必须显式 finish，finish 后出现任何事件仍失败。
- collector 自身响应取消与补答期限，不依赖供应商再返回一个 chunk。原始步骤取消后不派发迟到工具、不启动补答；对未结束迭代器请求 return()，不等待可能永久阻塞的清理，丢弃迟到结果。
- 重写块后丢弃旧供应商 replay metadata；计入原请求和补答的 token 用量。每次流收集最多2MiB，超限失败。仅处理指定 provider 的 agent-loop 请求；压缩、标题和其他 provider 不经过该出口。

## 启用

将本目录两个源码文件（output.mjs、plugin.mjs）放到一个固定发布目录，在该 ACP 启动器的最后一层 patch 追加：

~~~yaml
- insert:
    - id: conest-public-output
      name: /absolute/release/path/plugin.mjs
      config:
        providers:
          - your-provider-id
~~~

桥接对应项目应配置：

~~~toml
[projects.display]
thinking_messages = false
tool_messages = false
~~~

plugin.mjs 从实际运行的 DSH 安装解析 dsh-llm，确保使用同一个 loop-marker 实例。不支持的运行时或配置缺失会启动失败，不静默放行。升级 DSH 后必须重跑隔离真实 ACP 验收。源码/patch/二进制应作为一个发布单元备份、切换和回滚。

要允许首轮合法公开答复直接完成，在同一 config 下加 directReply: true。此模式要求 DSH systemPrompt 服务；schema 在 system-prompt/assemble 阶段加入，保留原工具、人设和历史，也不改写已记录的请求。公开数据调用只由本插件消费，不能进入执行器。数据调用与执行工具混合时整步失败，不执行任一调用，也不生成可能误称工具成功的补答。

这不是供应商强制格式保证，也不是首字流式播放。仍完整收集并严格校验首轮；取消、断流、错误终态不发布部分内容。格式不合格才启用原有 finalizer，保留原来的最多两次/60秒期限，不能保证异常轮也很快。只减少原来每轮必需的重复生成；说完到板子出声仍须另测 ASR、模型、TTS 和设备。

## 验证与代价

~~~sh
node --test integrations/dsh-public-output/*.test.mjs
~~~

测试覆盖未标记过程文字、闭标签引用、纯思考、空输出、分片不先发、无工具补答、失败/取消、两次上限、原工具ID、上下文不变、用量和并发隔离。真实隔离模型验证另行记录，CI不访问供应商或Discord。

本机安装了 DSH 时，可额外对照真实 BlockAssembler，并通过真实插件 apply / llm/stream middleware 和运行时 loop marker 验证。此命令只导入类型实现，provider 与上下文均为 fixture，不启动 DSH、不发模型请求、不读用户配置：

~~~sh
DSH_CONTRACT_ENTRY=/absolute/path/to/@deepseek-ai/dsh/lib/bin.js \
  node --test integrations/dsh-public-output/*.test.mjs
~~~

未设置该变量时跳过本机 DSH 运行时契约项；其他回归照常执行。

## Issue #155：证据与修复边界

2026-10-20 12:54 的生产错误由父 Agent 提供脱敏元数据：turn14 step27，原始步骤开始到失败约48.2秒，最终已有合并 usage。部署的两个文件与修复前 main 相同；持久化只保存 guard 处理后的流。现有证据表明已经进入补答，但不能还原补答次数、格式或具体失败分支。**本次现场底因未确认，不能把以下合成缺陷写成该次事故已确认根因。**

对照本机 DSH 0.1.5-rc.3 的 `StreamChunk`、`GenerateOptions`、`Message` 和 `BlockAssembler`：

- 交错块须按首次出现顺序组装；旧 collector 只按 block-end 到达顺序追加。两个有效 JSON 文本块反序结束时，真实 DSH assembler 得到合法 reply，旧 guard 拼坏 JSON，两次后返回同一条 `PUBLIC_ANSWER_UNAVAILABLE`。
- 真实 DSH assembler 支持 delta-only 文本；旧 collector 丢掉没有 block-end 的正文，合法 JSON 同样失败。现仅补齐 text/reasoning 组装；不凭部分工具参数拼造可执行调用。
- 原始步骤返回成功前已取消，旧 guard 仍发布完整工具调用；补答迭代器忽略 signal 时，旧 guard 不会因60秒期限自行结束。新增取消检查和可中断的读取等待覆盖这两个边界。
- `finalRequest` 契约验证通过，无证据要求修改它：替换 system、保留 provider/model/session 和关联工具结果、去掉 tools/stop/replayState，不将原终态草稿作为公开答案回填。

红色反馈命令 `node --test integrations/dsh-public-output/contract.test.mjs` 在修复前实现上为4失败、1通过：前两项精确出现 `PUBLIC_ANSWER_UNAVAILABLE`，后两项分别是 `tool-calls !== aborted` 和期限触发后 guard 未结束。修复后，本机带 `DSH_CONTRACT_ENTRY` 的模块全量为 **37通过、0失败、0跳过**，包括工具副作用一次、两次补答共用期限、迟到结果/清理异常、非成功终态、插件范围与私密内容不入诊断。真实 ACP 和全量 Go 由父 Agent 另外验证；本记录不代表已部署或真人验收。

## 安全诊断

v2 在失败分支写一条 `conest-public-output` 警告，只含 `stage`、`attempt`、`cause`。`stage` 为 original/finalize；原始步骤 attempt=0，已发起补答为1或2，发起前取消可为0。无请求正文、会话 ID、工具参数、补答文本或供应商错误消息。v3 对原请求失败另加白名单内 providerCode（见 #189），并使用原请求专属错误提示；日志异常不改变 guard 结果。

| cause | 能证明什么 |
| --- | --- |
| stream_contract / stream_incomplete / stream_after_finish / stream_limit | 流结构不符、缺少结束、终态后仍有事件或超出2MiB |
| transport | 流/请求抛出异常；没有记录或推测供应商错误内容 |
| provider_error / provider_aborted / max_tokens / unexpected_finish | 供应商返回已分类终态或未知终态；未知原值不写日志 |
| invalid_reply / unexpected_block | reply 严格校验失败或补答包含非文本/非reasoning块；可以消耗第二次格式尝试 |
| cancelled / timeout | 调用方取消或共用60秒补答期限触发；不会再尝试 |
| public_schema_missing | directReply 已开启但原请求缺少公开数据 schema，在模型调用前失败 |
| mixed_public_tools | 原始响应把公开数据与另一个调用混在一起，整步拒绝且不派发工具 |

这些枚举用于定位下一次失败，不代替上述修复或还原过去现场。若供应商完全不响应取消，其底层请求可能仍在运行/计费；插件能保证自身结束等待并丢弃迟到输出，不能强制终止第三方实现。

默认模式正常完成多一次模型调用，有额外延迟/费用；directReply 仅在首轮已有合法公开字段时省去它，均不会重跑已执行工具。补答是模型依据证据重新生成的，仍需核对事实。JSON 是明确的发布边界，不是语义审查器；无法数学上保证模型永远不会把内部文字写进 reply 字段。桥接显式标签过滤继续作为第二层保护。模型或上游故障仍可能导致明确失败，不能承诺每次都有答案。
## ACP 诊断出口（Issue #172）

失败的固定阶段、尝试次数、原因枚举同时写入 stderr（前缀 `[conest-public-output]`），供桥接日志保存。不能仅依赖 Cordis logger：ACP 没有可靠的持久化导出，默认缓冲还可能过滤 warn。诊断不包含正文、工具参数、原始异常或会话标识。补齐诊断不等于已定位此前统一错误的实际原因。

Issue #172：补答明确 JSON 字符串转义并给出合法示例；格式不合格时第二次请求增加固定纠正反馈，不回传坏答复或私密草稿。仍最多两次、共享60秒、严格校验、工具不重跑。15:59历史的隔离无工具验证修前5次失败3次，修后3次通过，样本有限。

## Issue #189：恢复原模型请求的错误路由

2026-10-21 00:00:36 的生产诊断是 `original / provider_error`，没有进入补答。v2 为了隐藏供应商正文，把原请求的所有错误替换成 `PUBLIC_ANSWER_UNAVAILABLE`。这同时抹掉了 DSH 有限重试和上下文溢出恢复依赖的 `failure.code`。历史原始错误码已经丢失，无法断言本次是限流、网络还是上下文溢出；以下确定性验证证明的是该错误处理缺陷。

v3 保留固定白名单内的机器分类、合法 HTTP status 和正有限 `providerRetryAfterMs`，错误描述统一由本模块生成；原始错误消息、请求 ID、body、cause、replayState 均不复制。未知分类折叠为 `PROVIDER_REQUEST_FAILED`，本地流契约失败为 `PUBLIC_STREAM_INVALID`，均不被误报为补答失败。诊断只增加经过同一白名单处理的 providerCode。

重试次数、退避与上下文恢复仍由 DSH 决定，插件不自行重跑整个任务；认证、余额、参数错误不加入可重试分类。原步骤取消、部分工具块和未知终态不派发工具。补答失败仍是 `PUBLIC_ANSWER_UNAVAILABLE`，不交回原步骤恢复，避免越过补答的两次/60秒边界。

验证：新增19项回归在旧实现上17失败，包含真实已安装 DSH 的 retry 和 context-overflow handler 不返回 retry；修后模块全量58项通过、0跳过，bridge 沙箱 Go 全量通过。上下文恢复契约使用真实注册处理器，昂贵的压缩操作是 fixture，并不代表线上长历史压缩已验收。隔离真实 ACP 两进程接续同一合成会话，每轮注入一次 RATE_LIMIT，都由运行时恢复后正确回答（391、392）；第一轮还遇到一次真实 TRANSPORT，亦恢复成功。两轮工具0、无私密标记、未发送 Discord 消息。生产部署另记统一交接，真人原频道验收仍待完成。

## Issue #213：12:10 格式失败后超时

2026-10-21 12:10:27 的现网 v3 已加载 #189；安全日志是 finalize/1/invalid_reply → finalize/2/timeout。不是漏部署，也不是原请求错误恢复没生效。本地回放该顺序可复现同一 RPC -32603。失败前历史的隔离投影为52条消息，最终请求约9.4万字符；真实同路由旧版首答正常 stop，却输出非JSON普通文字，11.8秒后拒收，第二答15.3秒纠正成功。无法还原生产首次输出具体内容，也不能把隔离成功当作历史超时已解决。

v4 使用 DSH 已有 ToolSchema 承载唯一 conest_public_reply 的数据；schema关闭额外字段、限制 reply 类型与长度。此请求没有 agent-loop marker，不包含原执行工具。结果在 guard 内完整收集，只有一个匹配名称的完整调用、合法终态及严格 reply 验证通过才转为普通 Text/stop，原始调用ID/参数不会交给执行器或写入后续操作历史。同伴过程文字、未知调用、多调用、错误终态和私密标记仍拒绝。旧的严格JSON正文接收保留兼容，但提示只要求专用格式，避免同时要求“不要调用工具/只输出JSON”的冲突。

两次尝试共用60秒、原模型/会话/历史证据、原请求恢复策略保持；不会重跑原任务、不会拿旧草稿或固定成功文案冒充结果。结构化通道减少已复现的格式失败，不能保证供应商不会超时或输出不合格字段。

验证：新增9项回归旧版3失败，修后带真实DSH运行时契约共67项通过、0跳过；实际插件middleware确认one-shot不重入loop、输出不含tool-call。最终候选的真实隔离历史验收、完整Go/CI及部署状态见PR；测试只替换原执行阶段，不调用任务工具、不发Discord消息，不回写原会话。
