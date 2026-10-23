# Codex / DSH 子 Agent 状态表（#86）

复用桥接已有的独立「子进程表」，按真实子 Agent 身份显示状态。普通 read_file、shell 等工具调用不是子 Agent；本功能也不启动子 Agent。

## 能力与安装

- **Codex app_server**：桥接直接读取 collabAgentToolCall 的子线程 ID、agentsStates，并监听已知子线程的 turn 状态。父会话结束一轮后仍可更新表格。
- **Codex exec**：读取对应的 collab_tool_call。只反映 CLI 实际输出的状态；exec 进程退出时把仍活动的行标为 stopped，保留已完成/失败的结果和可复用的跟踪表。下一次进程可重新激活子 Agent；两次启动之间没有持续事件流，不能承诺这一段实时更新。需要持续观察后台子 Agent 时使用 app_server。
- **DSH 经 ACP 接入**：桥接支持下述元数据扩展；DSH 的 ACP 包还需要本目录转发层。仅升级桥接不能让未转发事件的 DSH 出现表格。
- **其他 ACP 服务端、原生 dsh hook 适配器、Antigravity**：本次未增加各自的状态采集。普通 ACP 工具名不会被猜成子 Agent。

DSH 上游 ACP 当前不转发 subagent/start、subagent/end，且没有公开 notifier 插槽。本目录通过版本、源码位置校验，在 ACP 自己的通知通道内挂接原生生命周期；不另写 stdout、不读取会话日志、不修改模型或权限。

安装前先更新桥接，然后对实际启动 DSH 的包执行（包目录或包含 node_modules 的运行目录均可）：

~~~sh
node /path/to/bothouse/integrations/dsh-acp-subtasks/apply.mjs /path/to/dsh-acp
~~~

只支持已验证的 @deepseek-ai/dsh-acp **0.1.5-rc.3 / 0.2.1-rc.2**；未知版本或源码位置不匹配会拒绝修改。脚本保留 lib/index.js.before-bothouse-subtasks，重复执行不重复挂钩。原生作用域依赖通过 dsh-subagent 解析，兼容 pnpm 的依赖隔离。安装会在下一次 ACP 进程启动后生效，脚本不会重启任何服务。

npm/pnpm install 或升级可能覆盖转发层；升级后重新验证再安装。若保留的备份与当前上游文件相同，安装器会复用它并可直接重装；若两者不同，安装器会拒绝覆盖恢复副本，需要先人工核对。回滚时将保留的备份复制回 lib/index.js，在计划好的维护窗口重新启动 ACP。不需要手动删除恢复副本。

Discord 使用 progress_style = "card"；配置了 aux_channels 时表格随进展发送至日志频道。没有实际子 Agent 就没有表格。子 Agent 是否获准启动仍遵循原来的项目规则。

## 状态与隐私

Codex 的行 ID 是子线程 ID；DSH 的行 ID 是子会话 ID，另用原生 runId 区分同一子会话的多次激活。工具调用 ID 不是行 ID。

DSH 发标准 ACP tool_call / tool_call_update，扩展仅位于 update._meta：

~~~json
{
  "sessionId": "parent",
  "update": {
    "sessionUpdate": "tool_call_update",
    "toolCallId": "subagent/run-1",
    "status": "completed",
    "_meta": {
      "bothouse/subagent": {"id": "child", "runId": "run-1", "status": "completed"}
    }
  }
}
~~~

- 原生 start → running；本地子 Agent idle → waiting，重新 running → running；只有原生 end 才决定终态。
- end 的 completed → completed，aborted → stopped，error / max-tokens / refusal → failed。
- Go 接收端要求父 sessionId 精确匹配；重复 start、旧 runId 的结束事件不会重开或覆盖新任务。
- wait/send/close 工具返回不代表子 Agent 成功。桥接断开会将仍活动的行标为 stopped。
- 表格仅展示身份和状态，任务描述使用 ID；当前未采集可公开的任务摘要或逐步进展，不转发提示词、私密推理或最终正文。Codex / DSH 的这些事件不提供前台/后台标记，因此显示「子 Agent」而不猜；等待显示「等待继续」。Codex app_server 明确的 waitingOnApproval / waitingOnUserInput 显示等待，标记解除后恢复运行。

## 验证

~~~sh
node --test integrations/dsh-acp-subtasks/lifecycle.test.mjs
node integrations/dsh-acp-subtasks/verify-native.mjs /path/to/dsh-acp
cd bridge
go test -race -tags no_web -p 1 ./agent/codex ./agent/acp ./core ./platform/discord -run 'Test(CodexSubTasks|ACPSubTasks|SubTaskTracker|DiscordSubTask|SubTaskTable)' -count=1
go test -tags no_web -p 1 -count=1 ./...
~~~

verify-native.mjs 在临时副本安装，检查真实 DSH bundle 导入、Cordis 作用域投递、ACP SDK 元数据往返和隐私边界，不修改给定安装、不调用模型、不发真实频道。临时副本保留供检查。

回归测试覆盖：双子任务、等待工具误报、运行/等待/结束、重复事件、下一批、重新激活、旧事件、外来父会话、后台跨轮更新、关闭与通知竞争。旧 main（597bfa2）运行同一组适配器回归时因缺少 SubTaskReporter 失败；实现后通过。真实模型生成子 Agent 并在 Discord 展示仍需部署后的入口验收。
