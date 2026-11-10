---
name: sdk-clients-overview
description: sdk-clients 目录入口：Python 与 TypeScript SDK 功能页、实现深读页的链接，sdk clients 的代码快速入口表（sdks/python/src/jiuwenswarm_sdk/client.py）与 Python SDK Client 知识页链接
metadata:
  scope: 只收 sdk-clients 目录入口说明、链接与快速入口表；Client 的构造、清理与错误契约归 sdk-clients-knowledge，功能概览归 feature-sdk，实现深读归 feature-depth-sdk
---
# sdk-clients

## 现状

- 理解该代码 owner 的职责、接口、配置与相关功能时查这里；通用审查方法不属于本目录。
- [[feature-sdk]]（Python 与 TypeScript SDK 功能知识）
- [[feature-depth-sdk]]（Python 与 TypeScript SDK：实现深读）

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：sdk clients。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| sdk clients | 入口 | `sdks/python/src/jiuwenswarm_sdk/client.py` |

- [[sdk-clients-knowledge]]（jiuwenswarm Python SDK Client (sdks/python/src/jiuwenswarm_sdk/client.py)）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sdk-clients/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
