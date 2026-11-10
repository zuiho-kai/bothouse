---
name: feature-browser-tools
description: 浏览器服务与网页工具的职责边界、apply_swarm_browser_settings 入口、browser.chrome_path 各平台配置、托管 Chrome 的设计取舍与验证方法
metadata:
  scope: 只收浏览器服务与网页工具的功能概览（职责、入口、配置、取舍、验证）；实现深读归 feature-depth-browser-tools
---
# 浏览器服务与网页工具 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-browser-tools.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/browser_runtime.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/browser_config.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/浏览器.md
- 源页字段（feature）：browser-tools
- 入口（entry_points）：jiuwenswarm/agents/swarm/browser_runtime.py；jiuwenswarm/agents/harness/common/browser_config.py
- 源页字段（source_globs）：jiuwenswarm/agents/swarm/browser_runtime.py；jiuwenswarm/agents/harness/common/browser_config.py；jiuwenswarm/agents/harness/common/*；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/navigate.py
  - jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py；jiuwenswarm/channels/web/frontend/src/features/settings/modules/browser/definition.ts；jiuwenswarm/agents/harness/common/tools/browser_timeout_policy.py
  - jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/ensure_browser.py；jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py；scripts/verify_playwright_mcp_offline.py；jiuwenswarm/common/playwright_mcp_runtime.py
  - scripts/update_playwright_mcp_runtime.py；jiuwenswarm/agents/swarm/config_specs.py；jiuwenswarm/agents/swarm/providers/code_subagents.py；jiuwenswarm/server/runtime/agent_adapter/trusted_web_search.py；jiuwenswarm/channels/web/frontend/src/features/browserAgentActivity.ts
  - jiuwenswarm/agents/harness/common/tools/web_fetch_tools.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 浏览器与网页工具通过运行时后端获取页面和执行交互。可调用的工具集合、浏览器实例与外部资源可达性分别决定任务能否完成。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/swarm/browser_runtime.py:L1–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L1-L77)；
  - [jiuwenswarm/agents/harness/common/browser_config.py:L1–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L1-L32)；
  - [docs/zh/浏览器.md:L1–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%8F%E8%A7%88%E5%99%A8.md#L1-L190)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `apply_swarm_browser_settings(settings, config, session_id, member_id)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/swarm/browser_runtime.py:L1–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L1-L77)；
  - [jiuwenswarm/agents/harness/common/browser_config.py:L1–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L1-L32)；
  - [docs/zh/浏览器.md:L1–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%8F%E8%A7%88%E5%99%A8.md#L1-L190)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `browser.chrome_path.windows`、`browser.chrome_path.macos`、`browser.chrome_path.linux`、`browser.headless`。这些是示例字段，不单独证明源码默认值或全部优先级。 文档中的调用选项包括 `--headless`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/swarm/browser_runtime.py:L1–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L1-L77)；
  - [jiuwenswarm/agents/harness/common/browser_config.py:L1–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L1-L32)；
  - [docs/zh/浏览器.md:L1–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%8F%E8%A7%88%E5%99%A8.md#L1-L190)。

### 设计取舍

- **设计推断**：服务端托管 Chrome 为 Agent 提供真实页面操作，运行时按需启动浏览器；代价是 Chrome 路径、显示模式、实例与连接生命周期需要正确配置。Electron 内置浏览器与独立 Chrome 使用不同宿主，不能把一套启动选项无条件搬到另一套。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/swarm/browser_runtime.py:L1–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L1-L77)；
  - [jiuwenswarm/agents/harness/common/browser_config.py:L1–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L1-L32)；
  - [docs/zh/浏览器.md:L1–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%8F%E8%A7%88%E5%99%A8.md#L1-L190)。

### 数据流与关联功能

- 浏览器与网页工具通过运行时后端获取页面和执行交互。可调用的工具集合、浏览器实例与外部资源可达性分别决定任务能否完成。 联调时结合[[feature-browser-client]]（Chromium 浏览器扩展）、[[feature-desktop]]（桌面宿主与自动更新）、[[feature-harness]]（Agent Loop 与 Rail 装配）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/swarm/browser_runtime.py:L1–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L1-L77)；
  - [jiuwenswarm/agents/harness/common/browser_config.py:L1–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L1-L32)；
  - [docs/zh/浏览器.md:L1–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%8F%E8%A7%88%E5%99%A8.md#L1-L190)。

### 怎样验证

- 配置 Chrome 后执行访问、提取和一次表单操作，核对浏览器实例与任务会话。覆盖浏览器不存在、页面不可达、取消与实例清理；分别验证独立 Chrome 和 Electron 宿主的连接方式。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/swarm/browser_runtime.py:L1–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/browser_runtime.py#L1-L77)；
  - [jiuwenswarm/agents/harness/common/browser_config.py:L1–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/browser_config.py#L1-L32)；
  - [docs/zh/浏览器.md:L1–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%8F%E8%A7%88%E5%99%A8.md#L1-L190)。
