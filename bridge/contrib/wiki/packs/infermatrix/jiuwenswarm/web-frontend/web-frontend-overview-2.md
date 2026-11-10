---
name: web-frontend-overview-2
description: web-frontend 目录导航（下）：连接器、持续目标、计划模式、产物、语音等功能知识页，knowledge-web-frontend，各实现深读页，以及 web-frontend-rules 的链接
metadata:
  scope: 只收目录导航后半：功能知识页、实现深读页和审查规则页链接；子目录入口列表归 web-frontend-overview-1
---
# web-frontend（2/2）

## 现状

- 拆分说明：本页是源页 `_index.md` 的第 2/2 部分；第 1 部分 [[web-frontend-overview-1]]
- [[feature-connectors]]（连接器市场与 MCP 授权流程功能知识）
- [[feature-goal-mode]]（持续目标与会话控制功能知识）
- [[feature-plan-mode]]（计划模式与多入口切换限制功能知识）
- [[feature-artifacts]]（会话产物列表、预览与下载功能知识）
- [[feature-speech-interaction]]（语音输入、回复朗读与停止功能知识）
- [[knowledge-web-frontend]]（Web 静态入口：产物、接口、配置与验证） — 说明接口、配置与集成边界，关联源码和维护者文档。
- [[feature-depth-web-chat]]（Web 对话与流式状态：实现深读）
- [[feature-depth-web-navigation]]（Web 页面与功能入口：实现深读）
- [[feature-depth-agent-management]]（智能体资产管理与工作区浏览：实现深读）
- [[feature-depth-connectors]]（连接器市场与 MCP 授权流程：实现深读）
- [[feature-depth-goal-mode]]（持续目标与会话控制：实现深读）
- [[feature-depth-plan-mode]]（计划模式与多入口切换限制：实现深读）
- [[feature-depth-artifacts]]（会话产物列表、预览与下载：实现深读）
- [[feature-depth-speech-interaction]]（语音输入、回复朗读与停止：实现深读）
- [[feature-chat-session-stats-dashboard]]（IDE Webview 会话统计栏与每轮迷你图（chat.html））
- [[feature-code-mode-branch-selector]]（代码模式分支选择器（CodeBranchSelector））
- [[feature-code-mode-commit-push-1]]、[[feature-code-mode-commit-push-2]]（代码模式提交/推送对话框（CodeCommitPushControl））
- [[feature-context-usage-indicator-1]]、[[feature-context-usage-indicator-2]]（上下文占用指示器（ContextUsageIndicator：环形触发器/悬浮提示/明细弹层））
- [[feature-dev-ws-traffic-logger]]（Vite Dev WS Traffic Logger (/__dev/ws-log)）
- [[feature-frontend-incremental-lint-gate]]（前端增量 ESLint 门禁（lint-changed.mjs））
- [[feature-web-native-directory-picker]]（Web 通道本机目录/可执行文件选择器（directory_picker））
- [[feature-share-image-export]]（会话分享图导出：任务注册表与无头渲染器）
- [[feature-web-asset-publish-flow]]（Web 资产发布流程（prepare/commit/轮询/提交锁））
- [[feature-web-i18n-zh-en]]（Web 前端中英双语 i18n 初始化（jiuwenswarm/channels/web/frontend））
- [[feature-rsi-experiment-ui]]（RSI 自我改进实验页（创建/列表/配置回显））
- [[feature-depth-chat-session-stats-dashboard]]（Chat Session Stats Bar and Per-Turn Mini Charts：实现深读）
- [[feature-depth-code-mode-branch-selector]]（代码模式分支选择器（初始化/切换/创建分支）：实现深读）
- [[feature-depth-code-mode-commit-push]]（提交/推送对话框（commit、push、commit_push）：实现深读）
- [[feature-depth-context-usage-indicator]]（上下文占用指示器（环形/悬浮提示/明细弹层）：实现深读）
- [[feature-depth-dev-ws-traffic-logger]]（Vite Dev WS Traffic Logger (/__dev/ws-log)：实现深读）
- [[feature-depth-frontend-incremental-lint-gate]]（增量 ESLint 门禁（相对基线只报新增诊断）：实现深读）
- [[feature-depth-rsi-experiment-ui]]（RSI 自我改进实验页（创建/列表/配置回显）：实现深读）
- [[feature-depth-share-image-export]]（Session Share-Image Export (Job Registry + Headless Renderer)：实现深读）
- [[feature-depth-web-asset-publish-flow]]（Web 资产发布流程（prepare/commit/轮询/提交锁）：实现深读）
- [[feature-depth-web-i18n-zh-en]]（Web 前端中英双语 i18n 初始化：实现深读）
- [[feature-depth-web-native-directory-picker]]（Web 通道本机目录/可执行文件选择器（跨平台后端链）：实现深读）
- [[web-frontend-rules]]（web-frontend 审查规则） — 配额导航开关必须走完整 HTML 注入链并清理残留导航。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-09
