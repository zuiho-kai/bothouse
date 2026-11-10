---
name: feature-depth-rsi-dataset-folder-check
description: check_folder.py 实现深读：main 汇总 problems 返回 0/1、CLI 参数个数、seed 遍历与 files_in_seed 比对、scorecard.json 无守卫读取、traceback 嗅探只进 warnings、workers/iterations/max_tokens 校验、文档化手工步骤（未执行）
metadata:
  scope: 收 check_folder.py 的实现细节（main 流程、seed 遍历、缺失文件分支、警告通道、数值规则、手工验证记载），来源另含 SKILL.md；功能概览归 feature-rsi-dataset-folder-check
---
# RSI 数据集任务文件夹完整性预检：实现深读

## 现状

- [[feature-rsi-dataset-folder-check]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main()：校验参数后读取 run/scorecard.json，收集 problems 并以 0/1 返回** argv 不是恰好 2 个时记录 __doc__ 并返回 1；否则读取 root/run/scorecard.json，逐项把问题追加到 problems 列表，最后拼成一条消息用 logger.info 输出（无问题时为 "ok: …"），并返回 1 if problems else 0。该返回值经 L217-218 的 sys.exit(main()) 变为进程退出码。
- 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L67–L83
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L67-L83`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L210–L218
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L210-L218`）
- **CLI contract: exactly one argument (task folder); wrong arity logs __doc__ and returns 1** Callers invoke `python scripts/check_folder.py <task-folder>`; if len(sys.argv) != 2 the script logs its docstring and returns 1. It never imports the seed or runs the evaluator — it only checks shape,
  - key sets, and numeric floors.
- 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L1–L9
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L1-L9`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L67–L73
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L67-L73`）
- **检查结果依赖 task.json 的 files_in_seed/artifact_path 与 seed/ 目录遍历一致** 脚本用 rglob("*") 遍历 seed/，跳过目录、.pyc 与含 __pycache__/、.git/、node_modules/、.venv/ 的相对路径，排序后要求 task.json 的 files_in_seed 与该清单相等，artifact_path 须等于按文件数推导的 expected，否则追加 problem——即清单或路径不同步会让文件夹被判不完整。
- 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L99–L127
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L99-L127`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L59–L64
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L59-L64`）
- **缺失文件走 problems 分支返回 1；scorecard.json 的读取与 JSON 解析无守卫，异常直接抛出** seed/ 不是目录、task.json 不是文件时分别追加 "no seed/ directory"、"no task.json" 并最终返回 1；但 L73 对 run/scorecard.json 的 read_text/json.loads 没有 try 分支，文件缺失或非法 JSON 会以未捕获异常终止，而不是进入 problems 汇总路径。
- 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L72–L85
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L72-L85`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L210–L214
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L210-L214`）
- **traceback 嗅探只进 warnings 不进 problems：不改变退出码，代价是只能提示无法证明** 设计推断（非作者历史意图）：
- 当 evaluator_file 以 .py 结尾且 script 含 "except" 却不含 "traceback" 时，只 logger.warning 提示（PROBE_REFUSED 风险），return 仍由 problems 单独决定——好处是不因文本启发式误判文件夹不完整，成本是注释自述这只是“smell”，无法测试运行时行为。（推断：益处为本实现的直接后果）
- 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L195–L208
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L195-L208`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L210–L214
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L210-L214`）
- **文档化的手工程序：运行 check_folder.py 并确认输出 ok（未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md 记载交付前运行 `python scripts/check_folder.py <task-folder>`，并要求第 2 项检查“上述检查打印 ok”；同时说明它只查形状/键集/数值下限，不导入 seed、不运行 evaluator。此为已记载的手工步骤，本轮未执行，不能据此声称测试已通过。validation_kind: documented_manual。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/SKILL.md:L265–L290](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/SKILL.md#L265-L290)
- **scorecard 数值与 options.mode 的校验规则（workers/iterations/max_tokens_per_call）** 从 card 读取 workers、iterations（缺省回退 0）：iterations < 4*workers 记 problem；options.mode 在 workers>1 时不得为 serial，workers==1 时必须为 serial；max_tokens_per_call（缺省回退 0）低于 32000 记 problem。
- 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L161–L178
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L161-L178`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-rsi-dataset-folder-check.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L1-L9
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L67-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L67-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L210-L218
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L99-L127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L59-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L72-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L210-L214
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L195-L208
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/SKILL.md:L265-L290
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L161-L178
- 源页字段（feature）：rsi-dataset-folder-check
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py
