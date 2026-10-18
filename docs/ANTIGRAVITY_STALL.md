# 大豆包“批完权限后卡住”（2026-10-18）

## 现象与证据

18:00–18:30，大豆包在批准一次工具权限后长时间没有输出，频道新消息只收到“消息已收到，将在当前任务完成后处理”。

- agy 自身日志与会话库显示，批准后 agy 一直在工作：17:58 那轮 18 分钟执行了 107 步（58 次工具）；18:24 那轮被手动终止时仍在调用模型。
- 三次批准都是 Discord “允许所有”按钮（`allow all`），因此同一会话后续工具按设计自动批准，桥接日志里只出现一次审批。这不是 bug。隔离实验确认：桥接返回 `auto_approve` 后，agy 仍会对每次工具调用执行 PreToolUse hook（print 和 stream-json 两种模式都是）。
- 旧 stream 适配器只转发回答文字。工具步骤不产生任何事件，所以频道看不到进度，引擎 idle 计时也看不到进程还活着。
- 17:58 那轮的最后一次模型请求经本地代理报 `tls: bad record MAC`，重试后再无输出（CPU 0）。桥接没有 2 小时以内的兜底：`--print-timeout=24h`，`timeout_mins` 未配置。
- 18:22 那轮本轮步骤全部 DONE，但 result 报 ERROR（上一轮的 TLS 错误被抄进来，即 #34 的缺陷）。纠正它需要读取原生轨迹，而该会话已有约 370 步，轨迹 JSON 超过 8 MiB 读取上限，核验失败，误报得以保留。

与当日部署无关：antigravity 代码在 8f60890→b62782a2 之间没有变化，PR #50 不涉及前台事件和审批路径。

## 修复

1. stream-json 的 `tool` 步骤：ACTIVE 时发 EventToolUse（工具名和参数摘要，与审批卡展示的内容一致），失败或取消时发失败的 EventToolResult。不转发工具输出。频道因此能看到进度，引擎 idle 计时器也随之刷新。
2. 停滞看门狗 `stall_timeout_mins`（仅 stream_json，默认 15，0 表示关闭）。忙碌回合中，agy 超过该时长没有任何 stdout 时，结束进程并报“no progress … next message resumes this conversation”。工具执行中（ACTIVE 未结束）或审批等待中不计为停滞；这两种静默仍由引擎的 idle/turn 上限约束。
3. 原生轨迹读取上限从 8 MiB 提到 64 MiB，长会话的本轮核验可以重新生效。

## 验证

`go test -race -tags no_web ./agent/antigravity ./agent/antigravityhook`。新增测试覆盖：静默模型请求被中止、长时间工具不被误杀且有进度事件、审批等待中不触发、审批结束后能检测停滞。
