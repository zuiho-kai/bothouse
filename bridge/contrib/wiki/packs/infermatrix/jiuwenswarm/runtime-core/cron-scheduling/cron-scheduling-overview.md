---
name: cron-scheduling-overview
description: 定时任务与调度入口：什么时候查（CronJob schema、cron 表达式/时区、文件与 etcd 存储）、不收录的 Gateway 调度循环与 HA、代码快速入口 jiuwenswarm/runtime/cron/ 及专题页导航
metadata:
  scope: 只收定时任务组件的入口导航与查阅范围；任务模型与投递路由归 jiuwenswarm-runtime-cron，存储后端归 jiuwenswarm-cron-store，设计取舍归 cron-scheduling-design-tradeoffs
---
# 定时任务与调度

## 现状

### 什么时候查这里

- CronJob schema 与字段校验、cron 表达式/时区校验、mode 归一与超时。
- 共享创建/patch 规则、proactive.tick 任务保护、模型解析与 credential_ref 绑定。
- 文件存储（双层锁、原子写、惰性迁移）与 etcd 存储（CAS、watch、无文件回落）、后端选择配置。

### 不放什么

- Gateway 侧调度循环/主备 HA（gateway/cron/scheduler.py、controller.py）的运行行为。
- 钉钉会话编码之外的 IM 推送管线细节。

### 目录内容

- [[jiuwenswarm-runtime-cron]]（定时任务（Cron）运行时：任务模型、存储后端与投递路由） — 任务模型与校验、目标路由、执行模式与 proactive 保护、模型解析与凭据绑定、共享创建/更新规则、文件/etcd 双后端行为、表达式校验

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：cron、定时任务、cron job、cron 表达式、etcd、主备、HA、cron store、work_mode、proactive、钉钉推送、timezone。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| cron、定时任务、cron job、cron 表达式、etcd、主备、HA、cron store、work_mode、proactive、钉钉推送、time… | 入口 | `jiuwenswarm/runtime/cron/` |

### 专题入口

- [[jiuwenswarm-cron-store]]（Cron 文件与 etcd 存储后端） — 说明 CronJob 持久化、后端选择、文件锁、变更修订与 etcd CAS/watch；任务 schema、表达式和执行路由见 Cron 主页面。
- [[cron-scheduling-design-tradeoffs]]（Cron 后端与一致性的设计取舍） — 设计选择、收益与代价，以及 API、配置和关联功能入口。
- [[feature-cron]]（定时任务与调度存储 功能知识）
- [[cron-scheduling-contracts-01]]（cron-scheduling 源码接口与集成边界 01）
- [[feature-depth-cron]]（定时任务与调度存储：实现深读）
- [[cron-scheduling-knowledge]]（cron-scheduling：CronJob 模型、双后端存储与投递路由）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/cron-scheduling/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
