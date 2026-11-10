---
name: extensions-plugins-overview
description: 扩展与插件机制入口：extensions 主页面、AgentOS 与 video_duplex 扩展页、代码快速入口（触发词与首批源码）、验证入口测试文件和专题页导航
metadata:
  scope: 只收扩展与插件组件的入口导航和验证入口；扩展发现与 registry 细节归 jiuwenswarm-extensions，应用插件绑定归 jiuwenswarm-application-plugins，video_duplex 审查规则归 extensions-plugins-rules，设计取舍归 extensions-plugins-design-tradeoffs
---
# 扩展与插件机制

## 现状

- [[jiuwenswarm-extensions]]（扩展机制与 openYuanRong 集成（jiuwenswarm/extensions/）） — 扩展搜索/发现/加载顺序、registry 单例与槽位替换、hook 分发、应用插件绑定禁用门禁与 HTTP/WS/静态资源挂载约束
- [[jiuwenswarm-extensions-agentos]]（AgentOS 扩展：AgentOS Router 与 SSH/Token 鉴权）
- [[jiuwenswarm-extensions-video-duplex]]（视频全双工扩展（video_duplex））

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：extension、扩展、plugin、应用插件、hook、registry、loader、manifest、yuanrong、openYuanRong、clawee、sandbox。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| extension、扩展、plugin、应用插件、hook、registry、loader、manifest、yuanrong、openYuanRong、cl… | 入口 | `jiuwenswarm/extensions/agent_client/`、`jiuwenswarm/extensions/application_host.py`、`jiuwenswarm/extensions/callback_compat.py` |

- [[extensions-plugins-rules]]（video_duplex 全双工扩展审查规则：任务检查点、授权投递与 Provider 协议）

### 验证入口

- 扩展框架行为的单元测试在 `tests/unit_tests/test_extension_manager.py`（搜索路径、transport 标志）和 `tests/unit_tests/test_application_plugins.py`（禁用门禁、manifest-only 插件、资产路由）；`tests/unit_tests/extensions/` 下是 AgentOS 专属测试。

### 专题入口

- [[jiuwenswarm-application-plugins]]（应用插件绑定、前端贡献与资源挂载） — 说明 ApplicationPlugin 的 manifest-only 构造、宿主绑定、禁用门、HTTP 资产与 WebSocket 路由；扩展发现和进程生命周期见扩展主页面。
- [[extensions-plugins-design-tradeoffs]]（扩展与应用插件的设计取舍） — 设计选择、收益与代价，以及 API、配置和关联功能入口。
- [[feature-hooks]]（生命周期 Hooks 与扩展 功能知识）
- [[feature-applications]]（Application Plugin 与前端贡献 功能知识）
- [[feature-video-duplex]]（音视频双工扩展 功能知识）
- [[extensions-plugins-contracts-01]]（extensions-plugins 源码接口与集成边界 01）
- [[agent-client-overview]]（agent-client）
- [[agentos-overview]]（agentos）
- [[agentos-agentos-router-overview]]（agentos-agentos-router）
- [[agentos-auth-overview]]（agentos-auth）
- [[sdk-overview]]（sdk）
- [[video-duplex-backend-overview]]（video-duplex-backend）
- [[video-duplex-overview]]（video-duplex）
- [[video-duplex-frontend-overview]]（video-duplex-frontend）
- [[feature-depth-hooks]]（生命周期 Hooks 与扩展：实现深读）
- [[feature-depth-applications]]（Application Plugin 与前端贡献：实现深读）
- [[feature-depth-video-duplex]]（音视频双工扩展：实现深读）
- [[feature-agentos-sandbox-create-lifecycle]]（AgentOS 沙箱创建与幂等对账（jiuwenswarm agentos_router））
- [[feature-video-agent-managed-task-service]]（Voice/Video Duplex Managed Agent Task Service（持久队列、并发与不确定性语义））
- [[feature-yuanrong-faas-invocation]]（YuanRong FaaS 函数调用（非流式 + SSE 流式））
- [[extensions-plugins-knowledge]]（jiuwenswarm 扩展与插件：video_duplex 实时音视频 RPC 与 AgentOS Router 客户端）
- [[feature-yuanrong-agent-file-transfer]]（YuanRong Agent 容器文件传输（上传/下载/列举/建目录））
- [[feature-depth-agentos-sandbox-create-lifecycle]]（AgentOS 沙箱创建与幂等对账：实现深读）
- [[feature-depth-video-agent-managed-task-service]]（Voice/Video Duplex Managed Agent Task Service (Durable Queue, Concurrency, Uncertainty Semantics)：实现深读）
- [[feature-depth-yuanrong-agent-file-transfer]]（YuanRong Agent 容器文件上传/下载/列举/建目录：实现深读）
- [[feature-depth-yuanrong-faas-invocation]]（YuanRong FaaS 函数调用（非流式 + SSE 流式）：实现深读）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
