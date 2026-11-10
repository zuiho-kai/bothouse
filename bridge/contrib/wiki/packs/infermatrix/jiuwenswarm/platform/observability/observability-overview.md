---
name: observability-overview
description: 可观测性与轨迹存储目录入口：按 jiuwenswarm/observability 列出主页面 jiuwenswarm-observability，附触发词与代码快速入口表，并导航到轨迹保留、设计取舍、功能知识、实现深读与接口记录各页
metadata:
  scope: 只收本目录的导航与快速入口表；各页正文分别归 jiuwenswarm-observability、jiuwenswarm-trajectory-retention、observability-design-tradeoffs、feature-observability、feature-debug-trace、feature-depth-observability、feature-depth-debug-trace、observability-contracts-01、observability-knowledge
---
# 可观测性与轨迹存储

## 现状

- [[jiuwenswarm-observability]]（可观测性：Agent 轨迹采集、存储与保留（jiuwenswarm/observability）） — 准入身份校验与跨会话主体拒绝、有界双队列与快照合并/溢出计数、locked/busy 单次重试与冲突 first-wins、每会话 SQLite 路由与孤儿缓冲、Session 删除墓碑三段式、整页保留与检查点、查看器安全 OTLP 校验

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：observability、trajectory、轨迹、OTLP、trace、span、sink、SQLite、retention、保留、turn、session delete。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| observability、trajectory、轨迹、OTLP、trace、span、sink、SQLite、retention、保留、turn、sessi… | 入口 | `jiuwenswarm/observability/` |

### 专题入口

- [[jiuwenswarm-trajectory-retention]]（轨迹保留、检查点与查看器投影边界） — 说明已存轨迹的整页保留、检查点、OTLP 投影与持久化类型校验；记录准入、队列、writer 和会话删除见可观测性主页面。
- [[observability-design-tradeoffs]]（轨迹队列与存储的设计取舍） — 设计选择、收益与代价，以及 API、配置和关联功能入口。
- [[feature-observability]]（执行轨迹与保留 功能知识）
- [[feature-debug-trace]]（Debug Dump 与 OTel 功能知识）
- [[observability-contracts-01]]（observability 源码接口与集成边界 01）
- [[feature-depth-observability]]（执行轨迹与保留：实现深读）
- [[feature-depth-debug-trace]]（Debug Dump 与 OTel：实现深读）
- [[observability-knowledge]]（JiuwenSwarm 可观测性：轨迹存储路由、有界写入与每会话 SQLite（jiuwenswarm/observability））

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
