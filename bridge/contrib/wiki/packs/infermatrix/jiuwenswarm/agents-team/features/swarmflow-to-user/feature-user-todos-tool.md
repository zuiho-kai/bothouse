---
name: feature-user-todos-tool
description: user_todos 个人频道待办工具概览：list/get/create/update/delete/search、每频道单个 Markdown 文件存储、workspace 与 channel_id 作用域、读-改-整体重写取舍、输入校验与错误路径
metadata:
  scope: 只收 user_todos 工具的功能概览（支持行为、存储、配置、取舍、校验、入口契约）；create 流程、默认值、依赖、清洗非单射与失败模式的实现级细节归 feature-depth-user-todos-tool
---
# user_todos Personal Per-Channel Todo Tool

## 现状

- **Supported Behavior**
- Full CRUD plus search over per-channel todo items: statuses pending/in_progress/completed/cancelled, priorities high/medium/low, optional ISO-format `due_at`/`remind_at`, and free-text description.
  - On create, if `due_at` is given without `remind_at`, a reminder is auto-derived five minutes before the due time (empty string if parsing fails). Search is a case-insensitive substring match over title and description.
  - The tool description scopes it to the user's personal todos and explicitly steers agents away from using it for internal agent task planning (todo_create/todo_insert).
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L22–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L22-L32),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L276–L283](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L276-L283),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L364–L374](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L364-L374),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L196–L201](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L196-L201)
- **存储与数据流**
- 每个频道的待办存储为单个 Markdown 文件 `<workspace>/memory/user_todos/<sanitized_channel_id>.md`,条目用 YAML frontmatter(id/title/status/priority 等)加正文 description 序列化;频道 ID 取 `params.channel_id or ContextVar`。读取用正则切分 frontmatter 块,逐行按第一个冒号拆成键值;`TodoItem.from_dict` 抛异常的条目记录 warning 跳过,而没有 id 的块或未被正则匹配的内容则被静默忽略。
  - 写路径(create/update/delete)先整体重读文件、修改内存列表,再整体重写文件。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L109–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L109-L124),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L141–L158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L141-L158),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L182–L191](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L182-L191)
- **配置与作用域**
- 工作区目录由模块级全局变量 `_global_workspace_dir`(初始 ".")通过 `set_global_workspace_dir` 设置,决定 todos 目录基路径。频道与创建者通过 ContextVar 提供,默认分别为 "default" 和空串,可在每协程用 `set_global_channel_id`/`set_global_created_by` 覆盖。
  - 优先级用 `or` 实现:显式传入的空字符串(如 `params.channel_id=""`)会回落到 ContextVar 值(L243、L292);created_by 回落仅在 create 分支生效,update 分支对任何非 None 的 created_by(包括空串)直接赋值(L327-L328)。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L17–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L17-L19),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L93–L106](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L93-L106),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L243–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L243-L244),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L292–L292](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L292-L292)
- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 选择 Markdown+frontmatter 单文件作为存储,使内容对人和其他工具可直接读改,但读写是自定义的简化解析器(正则切块、按第一个冒号拆行),而非完整 YAML。变更操作采用读-改-整体重写:create 在 L297、update 在 L334、delete 在 L355 调用 `_write_todos_file` 重写整个文件,而 list/get/search 只读;所示代码中没有文件锁,并发写可能互相覆盖(推断,基于缺少锁机制的实现方式)。代码注释说明因模块级单例状态,工具以 `stateless=True` 注册为所有 agent 共享的单一注册。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L163–L179](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L163-L179),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L202–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L202-L207),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L182–L191](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L182-L191)
- **输入校验与错误路径**
- 所示代码中的校验全部是内联检查:未知 action 返回带合法 action 列表的错误;get/update/delete 要求 todo_id、create 要求 title、search 要求 query,缺失即返回 success=False;channel_id 经 `_sanitize_channel_id` 把非 `[a-zA-Z0-9_-]` 字符替换为下划线以防止路径穿越。
  - 状态/优先级字符串在 create/update 中直接构造 `TodoStatus(...)`/`TodoPriority(...)`,非法值抛出的异常由 `_handle_user_todos` 外层 except 捕获并转为错误字典。本片段未包含测试文件。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L114–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L114-L116),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L344–L346](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L344-L346),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L384–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L384-L395)
- **user_todos 入口与调用契约**
- 公开入口是 `@tool(name="user_todos", stateless=True)` 装饰的异步函数 `user_todos(params)`，另有 `get_decorated_tools()` 返回该工具的列表供注册。入参为 `UserTodosParams` dataclass（或 dict——入口会把 dict 按字段名过滤后转换），`action` 必填，取值 list/get/create/update/delete/search；
  - get/update/delete 要求 `todo_id`，create 要求 `title`，search 要求 `query`，这些必需参数的检查位于各自 action 分支内部。返回值为字典：成功时含 `success: True`（list/search 附 `todos`/`count`，get/create/update 附 `todo`），失败时含 `success: False` 与 `error` 字符串。
  - 非法 status/priority 等运行期异常由 `_handle_user_todos` 外层 except 捕获并转为 `{"success": False, "error": str(e)}`，不向调用方抛出。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L194–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L194-L230),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L255–L272](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L255-L272),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L384–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L384-L395),
  - [jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L398–L400](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L398-L400)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-user-todos-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L22-L32；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L276-L283
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L364-L374；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L196-L201
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L109-L124；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L141-L158
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L182-L191；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L17-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L93-L106；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L243-L244
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L292-L292；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L163-L179
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L202-L207；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L114-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L344-L346；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L384-L395
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L194-L230；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L255-L272
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/user_todo_tool.py:L398-L400
- 源页字段（feature）：user-todos-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/user_todo_tool.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/user_todo_tool.py
