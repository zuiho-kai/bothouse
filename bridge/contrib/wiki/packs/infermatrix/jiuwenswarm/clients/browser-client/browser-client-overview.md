---
name: browser-client-overview
description: browser-client（Chromium 扩展）owner 入口：子目录 background、content、content-adapters 等的链接，以及「browser client」触发词的快速入口表（background/index.ts、sidepanel/index.ts）
metadata:
  scope: 只收 browser-client 的入口说明、子模块与功能页链接和快速入口表；功能入口归 feature-browser-client，实现深读归 feature-depth-browser-client，背景服务与内容脚本归 browser-client-knowledge，顶层构建配置契约归 browser-client-contracts-01；后台、内容脚本、适配器子目录入口归 background-overview、content-overview、content-adapters-overview
---
# browser-client

## 现状

- 理解该代码 owner 的职责、接口、配置与相关功能时查这里；通用审查方法不属于本目录。
- [[feature-browser-client]]（Chromium 浏览器扩展 功能知识）
- [[background-overview]]（background）
- [[content-overview]]（content）
- [[content-adapters-overview]]（content-adapters）
- [[options-overview]]（options）
- [[popup-overview]]（popup）
- [[browser-client-shared-overview]]（shared）
- [[sidepanel-overview]]（sidepanel）
- [[webview-overview]]（webview）
- [[feature-depth-browser-client]]（Chromium 浏览器扩展：实现深读）

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：browser client。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| browser client | 入口 | `jiuwenswarm/channels/browser/frontend/src/background/index.ts`、`jiuwenswarm/channels/browser/frontend/src/sidepanel/index.ts`、`jiuwenswarm/channels/browser/` |

- [[browser-client-knowledge]]（JiuwenSwarm browser-client（Chromium 扩展）背景服务与内容脚本）
- [[browser-client-contracts-01]]（browser-client 源码接口与集成边界 01）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
