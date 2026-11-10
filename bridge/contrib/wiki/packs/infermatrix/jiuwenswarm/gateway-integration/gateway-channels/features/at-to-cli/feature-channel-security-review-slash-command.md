---
name: feature-channel-security-review-slash-command
description: /security-review 斜杠命令概览：消息处理循环识别 SECURITY_REVIEW_OK、build_security_review_prompt 预执行 4 条只读 git 命令（origin/HEAD...）、GitPreExecError 中止、preferred_language 与 cwd=None 回退、设计取舍和校验行为
metadata:
  scope: /security-review 的入口契约、可配置项、行为、取舍、控制流与可观察校验；_build_inlined_intro、异常传播细节和单测断言归 feature-depth-channel-security-review-slash-command
---
# /security-review 安全审查斜杠命令与 git 预执行

## 现状

- **入口与函数契约**
- 命令在网关消息处理循环中被识别（ParsedControlAction.SECURITY_REVIEW_OK），取解析出的附加参数与消息 metadata 里的 cwd，调用 `build_security_review_prompt(extra_arg, cwd)` 生成 prompt，替换 msg.params 的 query/content 后继续转发。`build_security_review_prompt` 是公开构建函数：cwd 非 None 时预执行 4 条只读 git 命令并内联输出；
  - 任一非零退出抛 `GitPreExecError`，调用方捕获后通过 send_channel_notice 告知用户并 `continue` 中止转发。
- Sources / 来源：[jiuwenswarm/gateway/message_handler/message_handler.py:L4740–L4771](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L4740-L4771),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L243–L263](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L243-L263)
- **可配置项与来源**
- 该功能本身几乎没有用户可配置项：输出语言来自全局 config 的 `preferred_language`（经 `response_language_line()` 注入）；git 上下文目录取自消息 metadata 的 `cwd` 字段（非 dict 时为 None）。diff/log 基线固定为 `origin/HEAD...`，命令清单硬编码在 `_SECURITY_REVIEW_GIT_COMMANDS`，每条超时 30 秒。用户唯一输入是斜杠命令后的附加参数，去掉首尾空白后原样作为 "Additional instructions" 透传。
- Sources / 来源：[jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L18–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L18-L36),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L253–L263](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L253-L263),
  - [jiuwenswarm/gateway/message_handler/message_handler.py:L4741–L4746](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L4741-L4746)
- **支持的行为**
- 功能是安全审查 prompt 的确定性构建：cwd 存在时预执行 `git status`、`git diff --name-only origin/HEAD...`、`git log --no-decorate origin/HEAD...`、`git diff origin/HEAD...` 四条只读命令，输出按固定标签内联进 prompt，LLM 无需自行跑 git；cwd 为 None（如单测、无仓库上下文）时回退到旧的指令式 prompt，行为不变。参数校验前置：参数过长或含非法控制字符时发 notice 拒绝。prompt 正文要求只报高置信度漏洞，附排除清单与输出格式。
- Sources / 来源：[jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L14–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L14-L23),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L48–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L48-L60),
  - [jiuwenswarm/gateway/message_handler/message_handler.py:L4732–L4739](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L4732-L4739)
- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 预执行 + 内联的收益是把上下文获取变成确定性的：LLM 不再自行跑 git，失败语义明确（注释说明 git 语义下 exit!=0 才是真失败，有 diff 时 exit 0）。代价是同步 subprocess 开销（注释提及 4×30s 最坏情况），用 executor 缓解但仍占用线程；基线硬编码 `origin/HEAD...`，在 origin/HEAD 未设置或无共同历史的仓库会直接中止整个命令。回退路径保留旧行为是兼容性取舍。
- Sources / 来源：[jiuwenswarm/gateway/message_handler/message_handler.py:L4747–L4758](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L4747-L4758),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L14–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L14-L22)
- **控制流与数据流**
- 消息处理循环识别出 ParsedControlAction.SECURITY_REVIEW_OK 后，从消息 metadata 取 cwd（非 dict 时为 None），经 `run_in_executor` 调用 `build_security_review_prompt(extra_arg, cwd)`，把返回的 prompt 覆盖写入 msg.params 的 query/content 后继续向 Agent 转发。
  - prompt 构建分两条路径：cwd 非 None 时在 `_run_security_review_git` 中同步预执行 4 条只读 git 命令（每条 timeout=30s）并内联输出；cwd 为 None 时退回指令式 fallback prompt，让 LLM 自行跑 git，不触发任何子进程。异常处理只针对 `GitPreExecError`（git 非零退出）：捕获后 send_channel_notice 告知用户并 `continue` 中止转发；`subprocess.run` 自身抛出的其他异常（如超时）不在该 except 范围内，所示代码未体现其处理方式。
- Sources / 来源：[jiuwenswarm/gateway/message_handler/message_handler.py:L4740–L4771](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L4740-L4771),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L243–L263](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L243-L263),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L26–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L26-L45)
- **可观察的校验行为**
- 所示片段中该功能的校验发生在两处命令前置检查与 git 预执行：参数过长或含非法控制字符时（SECURITY_REVIEW_OK 之前的分支）发 notice 拒绝该消息；cwd 非 None 时任一 git 命令非零退出抛 `GitPreExecError`，由消息处理器转为 notice 并中止。源码注释以「如单测」举例说明 cwd=None 的 fallback 路径，但这只是举例措辞，所示输入未包含任何测试文件，不能据此断言实际存在的测试入口或其覆盖范围。
- Sources / 来源：[jiuwenswarm/gateway/message_handler/message_handler.py:L4732–L4739](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L4732-L4739),
  - [jiuwenswarm/gateway/message_handler/message_handler.py:L4759–L4766](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L4759-L4766),
  - [jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L48–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L48-L51)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-channel-security-review-slash-command.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L4740-L4771；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L243-L263
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L18-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L253-L263；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L4741-L4746
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L14-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L48-L60；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L4732-L4739
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L4747-L4758；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L14-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L26-L45；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L4759-L4766
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py:L48-L51
- 源页字段（feature）：channel-security-review-slash-command
- 入口（entry_points）：jiuwenswarm/gateway/message_handler/message_handler.py；jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py
- 源页字段（source_globs）：jiuwenswarm/gateway/message_handler/message_handler.py；jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py
