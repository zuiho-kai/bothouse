# Codex 原生手动压缩（Issue #85）

在 bot 原频道发送 `/compact` 或 `/compress`。桥接取得会话锁，应用已排队的模型选择，关闭空闲旧读取进程，再用相同 CLI、CODEX_HOME、供应商、模型与推理强度启动短生命周期 stdio App Server。

协议顺序：initialize → initialized → thread/resume（原 threadId）→ thread/compact/start。不发送用户提示词、不创建替代会话、不清空桥接历史。普通聊天仍使用原配置的 exec 或 app_server 后端；下一条消息重新接续原 thread。

RPC 空结果只表示接受。必须同一 thread/turn 出现 contextCompaction item/completed，随后 turn/completed 状态为 completed，且 RPC 成功返回，才报告完成。idle、断连、失败、中断、缺少压缩事件均不能冒充成功。

- 无原生会话：明确提示，不新建。
- 忙碌时：拒绝并发压缩；压缩期间新消息提示正在处理，请稍后重发。
- `/stop`：取消并关闭临时进程，保留原会话；失败后可重试。
- 总超时五分钟，包含启动与协议过程。
- 模型容量不足：显示错误，先 `/model` 选择可用模型再压缩。
- 自动压缩路径不变，不自动跨供应商切换。

协议来源：OpenAI App Server 文档 Trigger thread compaction。本机 CLI 生成的 schema 已核对请求和通知字段；不兼容的 CLI 明确失败，不降级为自然语言命令。

## 验证

旧入口回归测试先复现“不支持压缩”。新增测试使用真实 Engine、SessionManager 和模拟平台，以及测试子进程实现的 JSON-RPC 服务，覆盖冷会话、排队模型、忙碌、工作区隔离、停止、失败重试、原会话继续回答、RPC 与终态顺序、错误、断连、超时、错误 thread/model 和缺少压缩事件。

本机 Go 全量测试、CUJ、相关 race、vet 和构建通过。未调用生产 Discord、未修改真实模型历史、未执行供应商真实压缩。模拟协议和 schema 不能替代真人端到端验收。

## 部署边界

本 PR 尚未部署。按 CONTRIBUTING 单独核对运行版本、忙闲、备份与回滚，不能直接用开发构建覆盖生产。部署后在空闲原会话选择可用模型、执行 `/compact`，追问已有信息，核对真实完成事件、原 thread ID 与续聊。
