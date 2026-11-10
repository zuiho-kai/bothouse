---
name: launch-overview
description: 启动与多实例管理入口：start_services、jiuwenswarm-init、dotenv_early、instance_manager 的页面导航，PR 改动路由表（start_services、--dotenv、--name、debug launcher）及 launch 下各功能页、深读页、契约页和子目录链接
metadata:
  scope: 只收入口导航、改动路由表和指向 launch 各页的链接；启动分派细节归 jiuwenswarm，桌面外壳归 jiuwenswarm-channels-desktop，多实例管理归 jiuwenswarm-instance-manager，设计取舍归 launch-design-tradeoffs
---
# 启动与多实例管理

## 现状

- [[jiuwenswarm]]（jiuwenswarm 顶层包：启动入口、多实例与运行时补丁） — start_services/jiuwenswarm-init/dotenv_early 的启动分派、端口回退持久化、子进程环境注入与就绪横幅
- [[jiuwenswarm-channels-desktop]]（桌面端应用外壳（channels/desktop））
- [[jiuwenswarm-instance-manager]]（instance_manager：多实例配置、端口与进程管理） — 端口分配公式与探测语义、instances.yaml 校验、InstanceLock/GatewayLock 与安全停止阶梯

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：start_services、jiuwenswarm-start、debug launcher、multi-instance、--dotenv、--name、jiuwenswarm-init、init workspace、dotenv_early、SSE patch、ModelArts、compat alias。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| start_services、jiuwenswarm-start、debug launcher、multi-instance、--dotenv、--name、… | 入口 | `jiuwenswarm/start_services.py`、`jiuwenswarm/dotenv_early.py`、`jiuwenswarm/init_workspace.py` |

- [[launch-design-tradeoffs]]（启动与实例隔离的设计取舍） — 设计选择、收益与代价，以及 API、配置和关联功能入口。
- [[feature-bootstrap]]（初始化与服务启动 功能知识）
- [[feature-instances]]（单机多实例 功能知识）
- [[feature-desktop]]（桌面宿主与自动更新 功能知识）
- [[launch-acp-overview]]（acp）
- [[channels-acp-overview]]（channels-acp）
- [[channels-desktop-overview]]（channels-desktop）
- [[cli-overview]]（cli）
- [[launch-contracts-01]]（launch 源码接口与集成边界 01）
- [[instance-manager-overview]]（instance-manager）
- [[feature-depth-bootstrap]]（初始化与服务启动：实现深读）
- [[feature-depth-instances]]（单机多实例：实现深读）
- [[feature-depth-desktop]]（桌面宿主与自动更新：实现深读）
- [[launch-knowledge]]（launch 组件基础：桌面外壳 desktop_app 的启动编排）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
