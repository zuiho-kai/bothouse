---
name: feature-depth-channel-security-review-slash-command
description: /security-review 实现深读：_build_inlined_intro 与 GitPreExecError、preferred_language 语言行、subprocess 依赖、git 非零退出分支、预执行与回退取舍、test_message_handler_security_review_prompt 断言
metadata:
  scope: security_review_prompt.py 的函数级细节与单测断言；命令入口契约、配置项和整体控制流归 feature-channel-security-review-slash-command
---
# /security-review 安全审查斜杠命令与 git 预执行：实现深读

## 现状

- [[feature-channel-security-review-slash-command]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **_build_inlined_intro 接收 git_outputs 字典；GitPreExecError 表示单条只读 git 命令非零退出的中止** _build_inlined_intro(git_outputs: dict[str, str]) -> str 以标签到命令输出的映射为入参返回 intro 字符串（可见片段只展示到循环开头，未见访问 git_outputs 具体键的行）。GitPreExecError(Exception) 的 docstring 定义为“某条只读 git 命令非零退出 —— 预执行失败的中止语义”。
- 来源：[jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L10–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L10-L11),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L63–L72](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L63-L72)
- **输出语言由 config 的 preferred_language 决定；cwd 缺省 None 回退指令式 prompt** 输出语言读取 get_config() 的 `preferred_language`（如 "en"→`Respond in English.`，"zh"→`Respond in Chinese (simplified).`）；cwd 参数缺省 None，此时退回旧的“指令式” prompt（让 LLM 自己跑 git），行为不变。
- 来源：[jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L243–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L243-L255),
  - [tests/unit_tests/gateway/test_message_handler_security_review_prompt.py:L48–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_message_handler_security_review_prompt.py#L48-L56),
  - [tests/unit_tests/gateway/test_message_handler_security_review_prompt.py:L28–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_message_handler_security_review_prompt.py#L28-L39)
- **security_review_prompt.py 依赖 subprocess 与 response_language_line；MessageHandler 导入其 GitPreExecError 与 build_security_review_prompt** 模块 import subprocess（预执行 git 的进程机制）并从 jiuwenswarm.gateway.message_handler.prompts 引入 response_language_line；
  - message_handler.py L53–L56 显式导入 GitPreExecError 与 build_security_review_prompt，把预执行失败异常类型与 prompt 构建函数耦合进 MessageHandler。调 subprocess 实际运行 git 的调用点不在已展示行内。
- 来源：[jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L5–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L5-L7),
  - [jiuwenswarm/gateway/message_handler/message_handler.py:L52–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L52-L56)
- **git 非零退出触发受保护分支：抛 GitPreExecError 携带命令、退出码与 stderr** subprocess.run 返回后先检查 result.returncode != 0，命中即 raise GitPreExecError(f"git {args} failed (exit {code}): {stderr.strip()}")，该条及后续命令输出不再写入 outputs；异常向上传播，本片段内无捕获。注释注明仅 origin/HEAD 未设置、无共同历史等真失败才非零。
- 来源：[jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L14–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L14-L22),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L39–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L39-L45)
- **取舍：预执行内联真实 git 输出，但分支无仓库上下文时退回让 LLM 自己跑 git 的指令式提示** 设计推断（非作者历史意图）：
- 收益（推理）：有 cwd 时把四段真实仓库状态内联进提示词，模型无需自行执行命令、结果确定。成本（推理）：无仓库上下文（cwd=None，如单测）时使用 _SECURITY_REVIEW_INTRO_FALLBACK 的旧指令式措辞，把执行 git 的负担和不确定性交回 LLM。此取舍由源码注释直接陈述。
- 来源：[jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L14–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L14-L17),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L48–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L48-L60)
- **单测运行时断言 prompt 文本、语言切换与 git 失败中止** tests/unit_tests/gateway/test_message_handler_security_review_prompt.py 实际调用 build_security_review_prompt 并断言：cwd=None 时含 `` `git status` `` 等指令且无 `Additional instructions:`（28-39 行）；zh 配置输出 `Respond in Chinese (simplified).`（48-56 行）；
  - 无 origin/HEAD 的仓库抛 GitPreExecError（136-141 行）。这些断言覆盖 prompt 构建函数本身，未覆盖斜杠命令的完整频道链路。
- 来源：[tests/unit_tests/gateway/test_message_handler_security_review_prompt.py:L28–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_message_handler_security_review_prompt.py#L28-L39),
  - [tests/unit_tests/gateway/test_message_handler_security_review_prompt.py:L48–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_message_handler_security_review_prompt.py#L48-L56),
  - [tests/unit_tests/gateway/test_message_handler_security_review_prompt.py:L136–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_message_handler_security_review_prompt.py#L136-L141)
- **_build_inlined_intro 依固定顺序为每个 git 标签追加标题块；fallback 文本指示运行 4 条命令** 在所示片段中，_build_inlined_intro(git_outputs) 先写入固定角色句，然后按 _SECURITY_REVIEW_GIT_COMMANDS 的固定顺序为每个标签（GIT STATUS、FILES MODIFIED、COMMITS、DIFF CONTENT）追加 "LABEL:" 与空行；git_outputs 的输出追加语句未在所示范围内。
  - 另有一条 fallback intro 文本，逐条指示运行同样的 4 条 git 命令并审查第 4 步 diff。片段未展示任何命令执行、退出码检查或调用分支。
- 来源：[jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L18–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L18-L22),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L63–L72](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L63-L72),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L50–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L50-L60)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-channel-security-review-slash-command.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L243-L255
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_message_handler_security_review_prompt.py:L48-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_message_handler_security_review_prompt.py:L28-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L14-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L39-L45
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L14-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L48-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_message_handler_security_review_prompt.py:L136-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L10-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L63-L72
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L5-L7；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L52-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L18-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L50-L60
- 源页字段（feature）：channel-security-review-slash-command
- 入口（entry_points）：jiuwenswarm/gateway/message_handler/message_handler.py；jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py
- 源页字段（source_globs）：jiuwenswarm/gateway/message_handler/message_handler.py；jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py
