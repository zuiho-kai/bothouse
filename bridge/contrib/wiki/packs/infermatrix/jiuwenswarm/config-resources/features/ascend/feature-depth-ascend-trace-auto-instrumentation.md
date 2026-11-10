---
name: feature-depth-ascend-trace-auto-instrumentation
description: instrument_operator 实现深读：--target/--root-label/--dry-run CLI 契约、函数名 process 使用 root_label 的例外规则、find_match_brace 未配平时兜底返回 len(text)-1、should_skip 子串级幂等跳过的取舍、apply_file 按位置降序插入 B/E 并写回的流程、仅标准库依赖与 FUNC_RE 多行正则识别、reference.md 记载的可选草稿插桩命令（未执行）
metadata:
  scope: 只收实现深读（CLI 契约、例外规则、兜底行为、幂等取舍、apply_file 流程、依赖、未执行的手动验收记录）；功能概览归 feature-ascend-trace-auto-instrumentation
---
# TRACE_POINT 自动埋点改写（instrument_operator）：实现深读

## 现状

- [[feature-ascend-trace-auto-instrumentation]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **CLI: --target 必填，--root-label 默认 processing，--dry-run 仅预览** main 通过 argparse 要求 --target（文件或目录），可选 --root-label 与 --dry-run；iter_targets 在目录模式下仅收集后缀为 .h/.hpp/.c/.cc/.cpp 的文件，apply_file 返回 (计数, 消息) 并由 logger.info 逐文件输出。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L108–L125
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L108-L125`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L101–L105
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L101-L105`）
- **--root-label 默认 processing，函数名 process 例外使用根标签** --root-label 默认值为 "processing"（argparse default）；apply_file 中仅当函数名小写等于 "process" 时使用 root_label，其他函数用 normalize_label 把驼峰/下划线转为小写连字符标签。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L111–L115
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L111-L115`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L61–L64
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L61-L64`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L82–L84
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L82-L84`）
- **未匹配闭括号时 find_match_brace 兜底返回 len(text)-1；无函数/已埋点时跳过** find_match_brace 扫描到文本末尾仍未配平时返回 len(text)-1（不抛错，end 语句可能插入到文件末字符前）；apply_file 在 find_functions 为空时返回 (0, "skip ... (no function found)")，全部函数已含埋点时返回 (0, "skip ... (already instrumented)")，两种情况均不写文件。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L48–L58
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L48-L58`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L74–L89
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L74-L89`）
- **子串级幂等跳过实现零依赖，但启发式识别可能漏配或错配** 设计推断（非作者历史意图）：
- 收益：should_skip 用子串判断即可避免重复插入，且只改写文件、无外部依赖。代价（推断）：FUNC_RE/括号计数忽略字符串与注释内容，未匹配到闭括号时 find_match_brace 回退返回 len(text)-1，end 语句可能插在最后一个字符之前；识别为启发式，不保证覆盖所有 C++ 函数形式。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L48–L58
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L48-L58`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L67–L68
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L67-L68`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L82–L86
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L82-L86`）
- **apply_file：FUNC_RE 定位函数后按降序插入 B/E 打点并写回** apply_file 读入文本后由 find_functions 用 FUNC_RE.finditer 提取函数块（find_match_brace 深度配对求 close_brace）；无函数返回 0 并报 skip。每个函数体经 should_skip 检查后构造 MoeTracing(TRACE_POINT(label,"B"/"E")) 编辑，编辑按位置降序逐个插入，非 dry_run 时写回磁盘并返回 len(edits)//2。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L36–L45
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L36-L45`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L71–L98
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L71-L98`）
- **仅标准库模块 + FUNC_RE 多行正则的文本级函数识别** 所引片段中脚本只 import argparse/logging/pathlib/re/dataclass/typing 标准库；函数识别完全依赖 FUNC_RE 单个多行正则（find_functions 于 L38 直接 FUNC_RE.finditer），find_match_brace 为纯字符深度计数，配对失败时回退返回 len(text)-1。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L10–L24
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L10-L24`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L36–L45
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L36-L45`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L48–L58
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L48-L58`）
- **文档化的可选草稿插桩命令（未执行，不能替代人工审查）** 文档中的人工验收步骤（本轮未执行）：
- reference.md 记载可运行 `python <skill_root>/scripts/instrument_operator.py --target <operator_src_file_or_dir> --root-label processing` 自动写入打点代码，并将其归类为「辅助（可选）——规划/草稿插桩，不能替代人工审查」。这是文档化手动流程，本次未执行，也不证明生成的插桩语义/编译正确。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L469–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md#L469-L479)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ascend-trace-auto-instrumentation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L108-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L101-L105
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L111-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L61-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L82-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L48-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L74-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L67-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L82-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L36-L45
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L71-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L10-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L469-L479
- 源页字段（feature）：ascend-trace-auto-instrumentation
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py
