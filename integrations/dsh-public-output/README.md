# DSH 公开答复出口

Issue #145。仅在需要阻止执行过程直接进入聊天正文的 ACP 部署上启用。使用 DSH 的 llm/stream 插件接口，不修改 node_modules，也不改模型身份或原会话。

## 为什么需要这一层

上游可能把思考放入普通 content；思考里还可能引用闭标签。因此“找到闭标签后放行剩余内容”没有可靠的公开边界。当前 DSH 0.1.5-rc.3 的 ACP 忠实地将 native text 转为普通正文，问题已经发生在它之前。

- 有工具调用的模型步骤：保留工具 ID/名称/参数，将普通 text 归入 native reasoning；Discord 须关闭 thinking_messages 与 tool_messages。不改变工具调用次数。
- 无工具的成功终态：原始草稿不公开。使用原对话和已发生的工具结果，额外发起一个无工具的答复请求；去掉 reasoning 和带私密标记的历史 assistant text，保留相关工具调用/结果。
- 只有严格 JSON 对象的唯一 reply 字段通过非空、长度及私密标记检查后才进入 native text。原始 SSE 和补答的 reasoning 从不直接发布。已有精确 NO_REPLY 保持静默。
- 最多两次格式尝试，共用60秒期限；网络/取消/非成功终态不重试。补答若返回工具请求会被丢弃，绝不交给工具执行器。失败有明确错误，不用旧草稿兜底。
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

未设置该变量时只跳过这一项本机运行时验证；其他回归照常执行。

## Issue #155：证据与修复边界

2026-10-20 12:54 的生产错误由父 Agent 提供脱敏元数据：turn14 step27，原始步骤开始到失败约48.2秒，最终已有合并 usage。部署的两个文件与修复前 main 相同；持久化只保存 guard 处理后的流。现有证据表明已经进入补答，但不能还原补答次数、格式或具体失败分支。**本次现场底因未确认，不能把以下合成缺陷写成该次事故已确认根因。**

对照本机 DSH 0.1.5-rc.3 的 `StreamChunk`、`GenerateOptions`、`Message` 和 `BlockAssembler`：

- 交错块须按首次出现顺序组装；旧 collector 只按 block-end 到达顺序追加。两个有效 JSON 文本块反序结束时，真实 DSH assembler 得到合法 reply，旧 guard 拼坏 JSON，两次后返回同一条 `PUBLIC_ANSWER_UNAVAILABLE`。
- 真实 DSH assembler 支持 delta-only 文本；旧 collector 丢掉没有 block-end 的正文，合法 JSON 同样失败。现仅补齐 text/reasoning 组装；不凭部分工具参数拼造可执行调用。
- 原始步骤返回成功前已取消，旧 guard 仍发布完整工具调用；补答迭代器忽略 signal 时，旧 guard 不会因60秒期限自行结束。新增取消检查和可中断的读取等待覆盖这两个边界。
- `finalRequest` 契约验证通过，无证据要求修改它：替换 system、保留 provider/model/session 和关联工具结果、去掉 tools/stop/replayState，不将原终态草稿作为公开答案回填。

红色反馈命令 `node --test integrations/dsh-public-output/contract.test.mjs` 在修复前实现上为4失败、1通过：前两项精确出现 `PUBLIC_ANSWER_UNAVAILABLE`，后两项分别是 `tool-calls !== aborted` 和期限触发后 guard 未结束。修复后，本机带 `DSH_CONTRACT_ENTRY` 的模块全量为 **37通过、0失败、0跳过**，包括工具副作用一次、两次补答共用期限、迟到结果/清理异常、非成功终态、插件范围与私密内容不入诊断。真实 ACP 和全量 Go 由父 Agent 另外验证；本记录不代表已部署或真人验收。

## 安全诊断

v2 在失败分支写一条 `conest-public-output` 警告，只含 `stage`、`attempt`、`cause`。`stage` 为 original/finalize；原始步骤 attempt=0，已发起补答为1或2，发起前取消可为0。无请求正文、会话 ID、工具参数、补答文本、供应商错误消息或错误码。公开失败文案保持原义，日志异常不改变 guard 结果。

| cause | 能证明什么 |
| --- | --- |
| stream_contract / stream_incomplete / stream_after_finish / stream_limit | 流结构不符、缺少结束、终态后仍有事件或超出2MiB |
| transport | 流/请求抛出异常；没有记录或推测供应商错误内容 |
| provider_error / provider_aborted / max_tokens / unexpected_finish | 供应商返回已分类终态或未知终态；未知原值不写日志 |
| invalid_reply / unexpected_block | reply 严格校验失败或补答包含非文本/非reasoning块；可以消耗第二次格式尝试 |
| cancelled / timeout | 调用方取消或共用60秒补答期限触发；不会再尝试 |

这些枚举用于定位下一次失败，不代替上述修复或还原过去现场。若供应商完全不响应取消，其底层请求可能仍在运行/计费；插件能保证自身结束等待并丢弃迟到输出，不能强制终止第三方实现。

正常完成多一次模型调用，有额外延迟/费用；不会重跑已执行工具。公开答复是模型依据证据重新生成的，仍需核对事实。JSON 是明确的发布边界，不是语义审查器；无法数学上保证模型永远不会把内部文字写进 reply 字段。桥接显式标签过滤继续作为第二层保护。模型或上游故障仍可能导致明确失败，不能承诺每次都有答案。
