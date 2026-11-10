---
name: feature-depth-ascend-trace-compile-safety-checker
description: check_compile_safety 实现深读：main() 遍历 .cpp/.h/.hpp（排除 build_out/pregen）并逐项检查的流程、operator_dir 位置参数与 --strict 的 sys.exit(1) 契约、默认 warnings 不影响通过而 --strict 时计入失败、依赖路径含 "op_kernel" 子串与 UTF-8 容错解码、花括号 depth<0 或文件末尾 depth≠0 的 ERROR 判定与行号定位、轻量正则/计数检查的取舍、reference.md 记载的手动检查命令（未执行）
metadata:
  scope: 只收实现深读（main 流程、CLI 契约、--strict 行为、目录布局耦合、brace depth 判定、取舍、未执行的手动验收记录）；功能概览归 feature-ascend-trace-compile-safety-checker
---
# 插桩编译安全静态检查器：实现深读

## 现状

- [[feature-ascend-trace-compile-safety-checker]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main() 遍历算子目录下 .cpp/.h/.hpp（排除 build_out/pregen）并逐项运行检查** main() 对 operator_dir 执行 rglob 收集 .cpp/.h/.hpp，过滤含 build_out 或 pregen 的路径，对每个文件跑 brace/preprocessor/trace-point/scope/profiling 检查，再对 op_kernel 文件做 header 可达性与 kernel 输出一致性检查，最后输出 warnings/errors 并在通过时打印 PASSED。
  - 单个 brace 检查内部发现 depth<0 时记录一条 error 后 return，仅跳过该文件剩余行，不影响其他文件。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L271–L285
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L271-L285`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L292–L301
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L292-L301`）
- **CLI 契约：位置参数 operator_dir 与可选 --strict，失败时 sys.exit(1)** main() 通过 argparse 接受位置参数 operator_dir（应含 op_kernel/ 与 op_host/ 的算子根目录）和可选 --strict；当存在 error，或 --strict 且有 warning 时，记 FAILED 并在 main 内调用 sys.exit(1)，否则输出 PASSED 汇总日志。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L258–L266
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L258-L266`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L292–L301
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L292-L301`）
- **唯一可配置项是 --strict；默认 warnings 不影响通过，--strict 时计入失败** 默认（无 --strict）下 result.ok 只取决于 errors 是否为空，warnings 仅逐条经 logger.warning 输出；--strict 且存在 warnings 时进入失败分支，error_count = errors + warnings 并 sys.exit(1)。日志仅在 root logger 无 handlers 时 basicConfig(level=INFO)。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L265–L265
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L265-L265`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L287–L301
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L287-L301`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L258–L260
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L258-L260`）
- **对算子目录布局与文件名子串的耦合；读文件按 UTF-8 容错解码** main 依赖 operator_dir 的目录布局：仅当路径含 "op_kernel" 子串时归入 kernel_files 并传给 check_header_reachability；rglob 收集 .cpp/.h/.hpp 后按 "build_out"/"pregen" 子串排除。read_lines 以 encoding="utf-8", errors="replace" 读取，解码失败字节被替换而非抛错。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L47–L48
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L47-L48`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L264–L264
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L264-L264`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L271–L283
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L271-L283`）
- **括号 depth<0 或文件末尾 depth≠0 各记一条 ERROR 并可定位到行号** check_brace_balance 在剥离注释/字符串后统计深度：depth<0 时 error("brace depth went negative ... likely extra '}'") 并 return；遍历完 depth!=0 时在最后一行报 "brace imbalance: depth=N at end of file (expected 0)"。这些 error 使 result.ok 为 False，main 打印 FAILED 并 sys.exit(1)。
  - CheckResult.ok 定义为 errors 列表为空。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L64–L73
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L64-L73`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L42–L44
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L42-L44`）
- **轻量正则/计数式检查：快速且无需编译，但不做真实语法解析** 设计推断（非作者历史意图）：
- （推断）收益：剥注释/字符串后按字符计数与正则匹配即可在任意算子目录快速给出带行号的错误；代价：如 #if 分支、宏展开或跨行字符串等真实预处理语义不在其能力内，注释剥离只处理 // 与双引号字符串，可能漏判或误判。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L55–L73
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L55-L73`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L76–L88
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L76-L88`）
- **Documented manual check: run check_compile_safety.py on <operator_dir>; --strict makes warnings errors (NOT EXECUTED)** 文档中的人工验收步骤（本轮未执行）：
- reference.md documents running `python <skill_root>/scripts/check_compile_safety.py <operator_dir>` and that adding `--strict` treats warnings as errors, i.e.
  - the observable expected result is that warnings escalate to errors under --strict; the same table states this check does not replace full OPP/pybind compilation. NOT EXECUTED here.
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L483–L484](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md#L483-L484),
  - [jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L470–L470](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md#L470-L470)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ascend-trace-compile-safety-checker.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L271-L285
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L292-L301
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L265-L265
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L287-L301
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L258-L260
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L64-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L42-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L55-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L76-L88
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L258-L266
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L47-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L264-L264
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L271-L283
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L483-L484
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L470-L470
- 源页字段（feature）：ascend-trace-compile-safety-checker
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/run_instrumentation_checks.sh
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py
