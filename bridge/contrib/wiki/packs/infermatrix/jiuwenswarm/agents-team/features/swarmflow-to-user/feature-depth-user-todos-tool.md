---
name: feature-depth-user-todos-tool
description: user_todos 实现深读：create 自动推导 remind_at（due_at 前 5 分钟）、params 或 dict 入参、channel 默认 default 与 workspace 默认 "."、stateless=True 注册、channel_id 清洗非单射、get 缺 todo_id 与异常转错误字典
metadata:
  scope: 只收 user_todo_tool.py 的实现级事实；工具的功能概览（行为、存储、配置、取舍、入口契约）归 feature-user-todos-tool
---
# user_todos Personal Per-Channel Todo Tool：实现深读

## 现状

- [[feature-user-todos-tool]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **create action appends a TodoItem and writes the channel's file** With title set, _handle_user_todos parses the channel file, derives remind_at = due_at − 5 minutes only when due_at is truthy, remind_at is unset and parses via datetime.fromisoformat (parse failure yields ""),
  - appends a TodoItem with uuid[:8] id and status/priority defaulting to PENDING/MEDIUM, writes the file, and returns success with the new todo dict.
- 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L270–L305](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L270-L305)
- **user_todos accepts a params object or dict and returns an operation result dict** The @tool-decorated async function user_todos takes UserTodosParams (or a dict filtered to its dataclass fields) with action in list/get/create/update/delete/search, optional channel_id,
  - and returns a Dict such as {"success": True, "todos": [...], "count": n} for list; the docstring notes channel_id defaults to the global channel id.
- 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L208–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L208-L230),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L246–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L246-L253)
- **Channel and workspace defaults: ContextVar channel "default", workspace "."** Module defaults are _global_workspace_dir="." and a ContextVar channel_id defaulting to "default"; when params.channel_id is unset, _handle_user_todos falls back to _ctx_channel_id.get(),
  - and todos live under <workspace>/memory/user_todos/<sanitized_cid>.md. Status/priority default to PENDING/MEDIUM on create.
- 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L17–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L17-L19),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L109–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L109-L124)
- **Registered via openjiuwen @tool as stateless=True; logging via jiuwenswarm logger** The module imports the tool decorator from openjiuwen.core.foundation.tool.tool and logger from jiuwenswarm.common.utils (L13–L14).
  - Registration uses stateless=True; the adjacent comment (L202–L205) states this is because the tool is a module-level singleton driven by set_global_workspace_dir/set_global_channel_id, so every agent shares one registration under its bare id — the comment's stated rationale,
  - not runtime-verified here.
- 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L13–L14](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L13-L14),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L194–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L194-L207)
- **Sanitization blocks path traversal but is not injective across channel ids** 设计推断（非作者历史意图）：
- Benefit: _sanitize_channel_id strips path separators and special characters, preventing channel-id path traversal into other directories.
  - Cost (inference): the substitution is many-to-one, so two distinct raw channel ids mapping to the same sanitized string would share one .md file; the shown code does not detect or prevent this collision.
- 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L114–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L114-L124)
- **get with missing todo_id returns success:false; any Exception is caught and converted to an error dict** 在 _handle_user_todos 的 get 分支中，params.todo_id 为空时本地返回 {"success": False, "error": "todo_id is required for get action"}；
  - 整个 action 分发的 try 中任何 Exception 都被 L390–L395 的 except 捕获，记录日志后返回 {"success": False, "error": str(e)}，不向调用方抛出。
- 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L255–L263](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L255-L263),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L384–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L384-L395)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-user-todos-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L17-L19；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L109-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L270-L305；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L208-L230
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L246-L253；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L13-L14
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L194-L207；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L114-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L255-L263；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L384-L395
- 源页字段（feature）：user-todos-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/user_todo_tool.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/user_todo_tool.py
