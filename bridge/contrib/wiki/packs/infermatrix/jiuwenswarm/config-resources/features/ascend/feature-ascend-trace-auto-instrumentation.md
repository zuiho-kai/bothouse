---
name: feature-ascend-trace-auto-instrumentation
description: instrument_operator.py 功能概览：--target/--root-label（默认 processing）/--dry-run 命令行契约、对 .h/.hpp/.c/.cc/.cpp 文件做函数级 TRACE_POINT B/E 插桩、should_skip 幂等跳过、--dry-run 预览与 skip/write 日志作为验证手段、正则+花括号深度计数而非真正解析器的架构取舍
metadata:
  scope: 只收功能概览（CLI 契约、插桩行为、幂等、验证方式、架构取舍）；实现深读（--root-label 例外规则、find_match_brace 兜底、apply_file 写回细节）归 feature-depth-ascend-trace-auto-instrumentation
---
# instrument_operator.py：TRACE_POINT 自动埋点改写脚本

## 现状

- **公开入口与命令行契约**
- 脚本作为命令行工具运行：`main()` 解析 `--target`（必需，源文件或目录）、`--root-label`（默认 `processing`）、`--dry-run`（预览开关）。对每个目标文件调用 `apply_file(path, root_label, dry_run)`，返回 `(插桩函数数, 日志消息)`；目录模式下通过 `iter_targets` 递归收集 C/C++ 源文件后逐个处理。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L108–L124
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L108-L124`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L71–L75
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L71-L75`）
- **可配置项与默认值**
- 仅三个 CLI 参数：`--target`（必需）、`--root-label` 默认 `processing`、`--dry-run` 标志（默认关闭即直接写盘）。root_label 只作用于名为 `process`（不区分大小写）的函数；其余函数标签由 `normalize_label` 从函数名派生（驼峰转连字符、下划线转连字符、转小写）。文件头注释还提到 "Max depth defaults to 5"，但所示代码中没有对应参数或逻辑。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L111–L115
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L111-L115`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L61–L68
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L61-L68`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L2–L8
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L2-L8`）
- **支持的行为**
- 对 `.h/.hpp/.c/.cc/.cpp` 后缀的文件（或单个指定文件）做函数级 TRACE_POINT 插桩：函数体开头插入 `"B"`、结尾插入 `"E"` 标记，缩进跟随原函数。幂等性通过 `should_skip` 实现——函数体已含 `MoeTracing(` 或 `TRACE_POINT(` 则跳过；无函数或全部已插桩的文件返回 0 且不写盘。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L101–L105
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L101-L105`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L77–L89
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L77-L89`）
- **验证方式**
- 所示片段不含测试；脚本自身提供的验证手段是 `--dry-run`（输出 `plan <path>` 与插桩计数，不写盘）以及每文件的 skip/write 日志和最终的 `instrumented functions: N` 汇总，可用于人工核对改写范围。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L88–L98
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L88-L98`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L119–L124
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L119-L124`）
- **架构与数据流**
- 脚本是一个独立的纯 Python 命令行改写器，流程为：`main()` 解析 CLI 参数并 `resolve` 目标路径，`iter_targets` 在目录模式下递归收集 `.h/.hpp/.c/.cc/.cpp` 文件；每个文件由 `apply_file` 处理——读入文本、`find_functions` 用单个多行正则 `FUNC_RE` 定位函数签名、`find_match_brace` 做深度计数式花括号配对得到函数体范围，随后在函数体开/闭花括号处插入 `MoeTracing(TRACE_POINT(label, "B"/"E"))`。
  - 所有编辑位置先收集再按位置降序一次性写回，最后（非 dry-run 时）整文件重写回磁盘并累计插桩函数数。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L21–L24
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L21-L24`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L36–L58
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L36-L58`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L71–L98
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L71-L98`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L101–L124
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L101-L124`）
- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 选择正则 + 花括号深度计数而非真正的 C++ 解析器：零依赖、实现极短，但代价是识别精度有限——`FUNC_RE` 依赖启发式签名模式，`find_match_brace` 对未闭合文件返回 `len(text)-1`，遇到字符串/注释中的花括号或非常规签名时可能配对错误。幂等性用简单的子串检查实现（函数体含 `MoeTracing(` 或 `TRACE_POINT(` 即跳过），代价是检查的是整个函数体文本而非精确语句。`--dry-run` 提供无副作用预览；实际写盘仅在非 dry-run 分支发生。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L21–L24
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L21-L24`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L48–L58
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L48-L58`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L67–L68
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L67-L68`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L95–L98
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L95-L98`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ascend-trace-auto-instrumentation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L108-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L71-L75
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L111-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L61-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L2-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L101-L105
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L77-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L88-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L119-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L21-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L36-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L71-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L101-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L48-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L67-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py:L95-L98
- 源页字段（feature）：ascend-trace-auto-instrumentation
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py
