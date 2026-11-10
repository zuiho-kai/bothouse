---
name: feature-projects-sessions-2
description: 项目、会话与历史管理功能入口（下）：project_id 与 work_mode 归属的设计推断、与 Agent/Code/Team 模式、Web 对话流式状态、Worktree 隔离工作的关联、session/project 创建重命名置顶列举删除的验证步骤
metadata:
  scope: 只收设计取舍、数据流与关联功能、怎样验证三节；职责边界与接口配置入口归 feature-projects-sessions-1，实现级证据归 feature-depth-projects-sessions
---
# 项目、会话与历史管理 的职责、接口与配置（2/2）

## 关键事实

- 拆分说明：本页是源页 `feature-projects-sessions.md` 的第 2/2 部分；第 1 部分 [[feature-projects-sessions-1]]
- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/feature-projects-sessions.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01

### 设计取舍

- **设计推断**：项目归属使用 project_id，会话还受 work_mode 分类；这种组织便于按代码工程和办公任务分别管理，代价是列表、置顶、删除与 Git 视图都要保留一致的归属。会话生命周期操作不能只删除目录而忽略仍在运行的任务。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/runtime/session_catalog.py:L1–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L1-L292)；
  - [jiuwenswarm/runtime/session_lifecycle.py:L1–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_lifecycle.py#L1-L181)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)。

### 数据流与关联功能

- 项目工作区与会话记录构成不同的数据边界。新建、恢复、切换和删除会话需要沿 Runtime 协调器确认对历史、执行和宿主状态的影响。 联调时结合[[feature-modes]]（Agent、Code 与 Team 模式）、[[feature-web-chat-1]]、[[feature-web-chat-2]]（Web 对话与流式状态）、[[feature-worktree]]（Worktree 隔离工作）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/runtime/session_catalog.py:L1–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L1-L292)；
  - [jiuwenswarm/runtime/session_lifecycle.py:L1–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_lifecycle.py#L1-L181)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)。

### 怎样验证

- 覆盖 session 和 project 的创建、重命名、置顶、列举与删除，核对响应身份和历史归属。Code 项目再验证 Git 状态、历史 diff 与撤销重做；运行中删除或切换会话时检查任务与订阅的收尾。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/runtime/session_catalog.py:L1–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_catalog.py#L1-L292)；
  - [jiuwenswarm/runtime/session_lifecycle.py:L1–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_lifecycle.py#L1-L181)；
  - [docs/zh/项目与会话管理.md:L1–L860](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B9%E7%9B%AE%E4%B8%8E%E4%BC%9A%E8%AF%9D%E7%AE%A1%E7%90%86.md#L1-L860)。
