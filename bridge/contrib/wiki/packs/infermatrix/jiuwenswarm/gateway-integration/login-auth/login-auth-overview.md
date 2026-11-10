---
name: login-auth-overview
description: login-auth 入口：华为账号登录与免费模型凭据主页面链接、代码快速入口表（触发词与 service.py、account_kit.py、session_store.py），及登录模型、设计取舍、功能知识、实现深读、源码契约页的链接
metadata:
  scope: 只收 login-auth 的入口目录与快速入口；各页正文归 jiuwenswarm-common-auth、jiuwenswarm-login-models、login-auth-design-tradeoffs、feature-login、login-auth-contracts-01、feature-depth-login、login-auth-knowledge
---
# 登录鉴权与免费模型

## 现状

- [[jiuwenswarm-common-auth]]（华为账号登录与免费模型凭据（common/auth）） — 覆盖 OAuth/PKCE 登录与待完成登录表、续期并发合并、AES-256-GCM 加密会话存档与跨进程共享、Gateway 凭据消毒、AgentServer 运行时句柄登记表与请求钩子、登录模型目录缓存

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：登录、华为账号、Account Kit、OAuth、PKCE、id_token、refresh_token、免费模型、积分、APIG、远端配置、auth。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| 登录、华为账号、Account Kit、OAuth、PKCE、id_token、refresh_token、免费模型、积分、APIG、远端配置、auth | 入口 | `jiuwenswarm/common/auth/service.py`、`jiuwenswarm/common/auth/account_kit.py`、`jiuwenswarm/common/auth/session_store.py` |

### 专题入口

- [[jiuwenswarm-login-models]]（登录模型目录与跨进程凭据句柄） — 说明登录模型在 Gateway 与 AgentServer 间的凭据传递、稳定句柄、请求钩子和目录缓存；OAuth 登录与加密会话持久化见登录主页面。
- [[login-auth-design-tradeoffs]]（登录凭据与续期的设计取舍） — 设计选择、收益与代价，以及 API、配置和关联功能入口。
- [[feature-login]]（账号登录与凭据续期 功能知识）
- [[login-auth-contracts-01]]（login-auth 源码接口与集成边界 01）
- [[feature-depth-login]]（账号登录与凭据续期：实现深读）
- [[login-auth-knowledge]]（login-auth：华为账号登录与免费模型凭据（common/auth））

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/login-auth/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
