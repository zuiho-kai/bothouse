---
name: common-core-overview
description: common-core 入口：公共基础模块（common）、ACP 客户端、配置面板、Schema 等页面的链接，代码快速入口表（config.py、model_catalog.py、mcp_config.py、_build_config.py），及审查规则、设计取舍、功能知识、实现深读与各源码契约页、子模块入口的链接
metadata:
  scope: 只收入口目录与快速入口；各页正文归被链接的页面，如 jiuwenswarm-common-1、jiuwenswarm-common-2、common-core-rules、common-core-design-tradeoffs、common-core-knowledge、jiuwenswarm-common-model-catalog
---
# 公共基础模块与配置

## 现状

- [[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（jiuwenswarm/common/：公共基础模块） — config.yaml 读写、模型目录与选择持久化、目录校验/连通性探测、permissions 与 MCP 配置面
- [[jiuwenswarm-common-acp]]（ACP stdio 客户端（common/acp））
- [[jiuwenswarm-common-config-panel]]（配置面板 handler（config_panel）） — Web/TUI config/models handler；provider 归一化与 reasoning 档位的序列化/校验
- [[jiuwenswarm-common-schema]]（公共 Schema：Agent 请求响应、统一消息与参数契约）

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：common、config、配置、模型选择、model catalog、mode、工作区、cron、updater、doctor、hooks、kv cache。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| common、config、配置、模型选择、model catalog、mode、工作区、cron、updater、doctor、hooks、kv cache… | 入口 | `jiuwenswarm/common/config.py`、`jiuwenswarm/common/model_catalog.py`、`jiuwenswarm/common/mcp_config.py`、`jiuwenswarm/common/_build_config.py` |

- [[common-core-rules]]（jiuwenswarm/common 审查规则：配置读写事务、跨仓契约与持久化键稳定性）

### 专题入口

- [[jiuwenswarm-common-model-catalog]]（模型目录、稳定选择与配置校验） — 说明共享配置模型的稳定业务 ID、目录视图、选择 DTO、候选写入与校验；登录凭据的产生和续期由 login-auth 拥有。
- [[common-core-design-tradeoffs]]（共享配置与模型目录的设计取舍） — 设计选择、收益与代价，以及 API、配置和关联功能入口。
- [[feature-models]]（模型平台与 API 配置 功能知识）
- [[feature-mcp]]（MCP 配置、凭据与资源 功能知识）
- [[common-core-contracts-01]]（common-core 源码接口与集成边界 01）
- [[common-core-acp-overview]]（acp）
- [[client-overview]]（client）
- [[config-panel-overview]]（config-panel）
- [[common-core-contracts-02]]（common-core 源码接口与集成边界 02）
- [[schema-overview]]（schema）
- [[security-overview]]（security）
- [[common-core-contracts-03]]（common-core 源码接口与集成边界 03）
- [[common-core-contracts-04]]（common-core 源码接口与集成边界 04）
- [[feature-external-cli-agents]]（外部 Claude 与 Codex CLI 智能体功能知识）
- [[common-core-knowledge]]（公共契约：配置缓存、ACP 设置与最终消息） — 说明接口、配置与集成边界，关联源码和维护者文档。
- [[feature-depth-models]]（模型平台与 API 配置：实现深读）
- [[feature-depth-mcp]]（MCP 配置、凭据与资源：实现深读）
- [[feature-depth-external-cli-agents]]（外部 Claude 与 Codex CLI 智能体：实现深读）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-09
