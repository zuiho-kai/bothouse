---
name: jiuwenswarm-common-acp
description: ACP stdio 客户端（common/acp）：AcpStdioClient 的 connect/chat/close 与 subprocess_env 的子进程环境变量隔离规则，及入口、关键文件、相关文档与路由
metadata:
  scope: 只收 common/acp 的 stdio_client.py 与 subprocess_env.py 的说明；ACP 参数的环境变量默认值归 common-core-knowledge
---
# ACP stdio 客户端（common/acp）

## 现状

- 这是一个最小化的 ACP 客户端：启动外部 ACP agent 子进程（如 Codex CLI），通过它的 stdin/stdout 收发 JSON-RPC 消息，负责连接、对话和关闭。它还为这类子进程组装环境变量，密钥和代理设置只从 config.yaml 的 `acp_agents.<profile>.env` 读取。
- **入口**
- `jiuwenswarm/common/acp/stdio_client.py` — `AcpStdioClient`：用 `connect()` 建立会话，`chat()` 发消息并取回文本，`aclose()`/`close()` 结束子进程
- `jiuwenswarm/common/acp/subprocess_env.py` — `build_acp_subprocess_env()`：为 ACP agent 子进程生成 env
- **关键文件**
- `jiuwenswarm/common/acp/stdio_client.py` — 缓冲 stdout，用 `raw_decode` 解析可能跨多行的 JSON；处理 JSON-RPC 调用和错误、session update 文本提取、agent 发来的反向请求（路径限定在会话根目录内）、stderr 读取和进程信号
- `jiuwenswarm/common/acp/subprocess_env.py` — 环境变量隔离规则：密钥和代理只取 profile env（支持 `${VAR}` 占位），不继承父进程，也不读 workspace `config/.env`；PATH、HOME 等系统变量仍取自 `os.environ`
- **相关文档**
- `docs/zh/ACP插件使用.md` — 改动涉及 ACP agent 的接入、配置或使用方式时先读
- **路由**
- `jiuwenswarm/common/acp/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/jiuwenswarm-common-acp.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
