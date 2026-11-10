---
name: feature-depth-auto-memory
description: 对话后自动记忆实现深读：启用开关与提取提示语言、AutoMemoryToolRestrictionRail 工具限制、缓存共享子代理分支、_is_in_memory_dir 路径判定与 /memory toggle 手动检查步骤
metadata:
  scope: 只收对话后自动记忆的调用链、守卫分支与运行时工具限制的实现细节；功能概览归 feature-auto-memory
---
# 对话后自动记忆：实现深读

## 现状

- [[feature-auto-memory]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **启用开关与提取提示语言** 文档记载 agent 模式用顶层 auto_memory_enabled、code 模式用 modes.code.memory.auto_coding_memory，默认均为 false。提取提示词由 build_extract_memories_prompt(language="zh") 生成，language 参数默认值也是 "zh"。
- 来源：[docs/zh/自动记忆.md:L21–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L21-L33),
  - [docs/zh/自动记忆.md:L99–L105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L99-L105),
  - [jiuwenswarm/agents/harness/common/auto_memory/prompts.py:L13–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/prompts.py#L13-L30),
  - [jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L236–L242](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L236-L242)
- **对 AutoMemoryToolRestrictionRail 的运行时工具限制** 缓存共享子 Agent 继承父 Agent 的全部工具，靠 AutoMemoryToolRestrictionRail.before_tool_call 在每次工具执行前做许可判定：只放行只读工具、只读 bash、memory_dir 内的写/编辑和 coding_memory 读写，其余调用 _deny_tool 拒绝。
- 来源：[jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L95–L189](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py#L95-L189),
  - [jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L372–L406](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L372-L406)
- **缓存共享分支：`_instance` 守卫通过后构造子代理，并把转换后的 history 传入 create_new_context_engine** 父 `_instance` 为 None 时记录 error 并 return；
  - 否则以 `max_context_message_num=None`、`default_window_round_num=None` 构造 ContextEngineConfig，子代理以 `rails=subagent_rails` 建立，history 经 `_convert_messages_to_base_messages` 转换后作为 `messages=` 传给 `sub_agent.create_new_context_engine`，得到 new_session_id。
- 来源：[jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L294–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L294-L312),
  - [jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L327–L345](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L327-L345),
  - [jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L400–L424](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L400-L424)
- **`_is_in_memory_dir(tool_args) -> bool`：路径先取 `file_path` 再取 `path`，仅当 `relative_to(self.memory_dir)` 成功才返回 True** 入参为工具参数字典；路径取 `file_path`，为空再取 `path`，两者皆空返回 False。绝对路径直接 resolve，相对路径按 `self.memory_dir` 拼接后 resolve；`relative_to` 成功返回 True，ValueError 或其他异常返回 False。
  - 调用方义务：`coding_memory_write`/`coding_memory_edit` 仅当返回 True 才放行。
- 来源：[jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L231–L279](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py#L231-L279),
  - [jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L169–L187](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py#L169-L187)
- **父适配器无 `_instance` 时记 error 并本地 return；`_is_in_memory_dir` 解析异常返回 False 使工具被拒** 触发条件是 `getattr(parent_agent, "_instance", None)` 为 None：记录 `[auto_memory] Parent adapter has no _instance, cannot proceed` 后 return，仅终止本次本地分支，不是进程退出码。路径解析抛出任何异常时 `_is_in_memory_dir` 记 warning 并返回 False。
- 来源：[jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L294–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L294-L312),
  - [jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L231–L279](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py#L231-L279)
- **子代理继承父工具以共享缓存（docstring 所述收益），代价是允许清单之外的任何工具一律落入拒绝分支** 设计推断（非作者历史意图）：
- 模块 docstring 称子代理继承父工具可共享缓存、由运行时限制防止越权使用；对应的成本是允许清单之外的任何工具都进入 deny 分支并记录 warning。收益为文档陈述，非所示运行时验证。
- 来源：[jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L5–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py#L5-L23),
  - [jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L169–L187](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py#L169-L187)
- **文档化手动检查（未执行）：/memory toggle 页签在 code mode 展示 auto_coding_memory 开关** 文档中的人工验收步骤（本轮未执行）：
- 文档化人工步骤（本轮未执行）：在 TUI 输入 /memory 或 /memory toggle 打开页签控制台，←/→ 切换页签、↑/↓ 移动、Enter 执行。预期 code mode 下 toggle 页签显示 auto_coding_memory 行，带 ✓ on / ✗ off 标记及需 memory_enabled 总开关开启的说明。此入口仅覆盖界面开关展示与操作，不代表后台提取或记忆文件写入已验证。
- 来源：[docs/zh/自动记忆.md:L35–L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L35-L44),
  - [docs/zh/自动记忆.md:L112–L135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L112-L135)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-auto-memory.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/自动记忆.md:L21-L33；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/自动记忆.md:L99-L105
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/prompts.py:L13-L30；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L236-L242
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L95-L189
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L372-L406
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L294-L312
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L327-L345
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L400-L424
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L231-L279
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L169-L187
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py:L5-L23；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/自动记忆.md:L35-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/自动记忆.md:L112-L135
- 源页字段（feature）：auto-memory
- 入口（entry_points）：jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py；jiuwenswarm/agents/harness/common/auto_memory/*
