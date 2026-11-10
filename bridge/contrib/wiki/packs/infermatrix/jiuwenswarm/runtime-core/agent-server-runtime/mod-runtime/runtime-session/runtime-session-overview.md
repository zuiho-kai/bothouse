---
name: runtime-session-overview
description: runtime-session 源码模块入口：链接 session 目录的源码接口与集成边界 01、02 页，以及装备写入元数据规则 JW-SESSION-META-1a 的审查规则页
metadata:
  scope: 只收入口链接与审查规则的一句摘要；逐文件声明归 runtime-session-contracts-01 与 runtime-session-contracts-02，规则正文归 runtime-session-rules
---
# runtime-session

## 现状

- 理解本 owner 的源码职责、接口和集成边界时查这里。源码接口记录是静态契约；功能语义、配置和取舍沿功能页查证。通用审查方法不放在这里。
- [[runtime-session-contracts-01]]（runtime-session 源码接口与集成边界 01）
- [[runtime-session-contracts-02]]（runtime-session 源码接口与集成边界 02）
- [[runtime-session-rules]]（runtime-session 审查规则） — 装备写入先排空旧元数据，再重读磁盘。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-session/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-09
