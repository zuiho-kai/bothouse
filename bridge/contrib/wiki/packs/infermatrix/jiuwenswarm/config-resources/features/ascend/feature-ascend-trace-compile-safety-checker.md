---
name: feature-ascend-trace-compile-safety-checker
description: check_compile_safety.py 功能概览：operator_dir 位置参数与 --strict 开关的命令行与退出契约、五项单文件检查（花括号/预处理指令配对/TRACE_POINT 语法/作用域/ENABLE_MOE_PROFILING 守卫）加头文件可达性与 kernel/op_host 输出数一致性检查的数据流、硬编码常量（基名集合、80 行作用域窗口）、PASSED/FAILED 日志作为验证入口、与不共享代码的 validate_trace_points.py 的分工
metadata:
  scope: 只收功能概览（CLI/退出契约、检查项与数据流、硬编码常量、验证入口、与配套脚本的分工）；实现深读（main() 遍历细节、brace depth 判定、目录布局耦合）归 feature-depth-ascend-trace-compile-safety-checker
---
# 插桩编译安全静态检查器（check_compile_safety.py）

## 现状

- **命令行入口与退出契约**
- 入口是 `main()`，通过 argparse 接收位置参数 `operator_dir`（算子根目录，含 op_kernel/ 与 op_host/）和可选开关 `--strict`（把警告当作错误）。检查结果汇总到 `CheckResult`（errors/warnings 两条列表，`ok` 属性表示无错误）；结尾按 PASSED/FAILED 打日志，失败或 strict 下有警告时以退出码 1 结束。
  - 配套脚本 `run_instrumentation_checks.sh <file-or-dir>` 用 exec 委托给 `validate_trace_points.py`，参数不足时报 usage 并 exit 1。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L258–L301
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L258-L301`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/run_instrumentation_checks.sh:L5–L11
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/run_instrumentation_checks.sh#L5-L11`）
- **职责与数据流**
- 这是一个无需真实编译器的静态检查器，模块头部明确说明其目的是在无法本地编译算子的环境中拦截会导致编译失败的常见插桩错误。数据流为：main() 递归收集算子目录下的 .cpp/.h/.hpp（过滤 build_out 与 pregen 路径），逐文件跑五个单文件检查（花括号平衡、预处理指令配对、TRACE_POINT 语法、作用域变量、ENABLE_MOE_PROFILING 守卫），再对 op_kernel 文件做头文件可达性分析，最后做 kernel 与 op_host 输出数一致性检查；各检查把结果写入共享的 CheckResult。
  - 读文件统一走 `read_lines`（utf-8，errors=replace）。配套的 validate_trace_points.py 是独立的质量检查器，专注标签命名风格与 B/E 配对计数，二者不共享代码。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L2–L17
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L2-L17`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L268–L285
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L268-L285`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py:L29–L50
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py#L29-L50`）
- **可配置项**
- 唯一的运行时配置是 CLI 参数：位置参数 `operator_dir`（要检查的算子根目录）和 `--strict` 布尔开关（warning 升级为 error 并影响退出码）。此外有硬编码在代码里的常量：头文件可达性检查认可的基名集合 {fused_deep_moe_base.h, moe_base.h, moe_dispatch_normal_base.h}，作用域检查回看的 80 行窗口，以及 kernel 系统参数固定按 2 计算；这些不可通过参数调整。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L261–L266
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L261-L266`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L141–L141
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L141-L141`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L184–L194
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L184-L194`）
- **测试与验证入口**
- 所示文件中没有针对这两个 Python 脚本的单元测试；它们本身即是验证工具：check_compile_safety.py 在结束时输出 "PASSED (N files, M warnings, 0 errors)" 或 "FAILED (N issues)" 并以退出码表达结果，validate_trace_points.py 输出检查文件数、label 数及 "validation passed"/"validation failed"。
  - `run_instrumentation_checks.sh` 是对外暴露的批量入口，直接 exec validate_trace_points.py。无法从这些局部输入判断仓库其他位置是否另有测试。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L292–L301
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L292-L301`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py:L73–L82
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py#L73-L82`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/run_instrumentation_checks.sh:L1–L11
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/run_instrumentation_checks.sh#L1-L11`）
- **支持的检查行为**
- 该脚本在不需要真实编译器的前提下，对算子目录下（过滤 build_out 与 pregen 路径）的 .cpp/.h/.hpp 逐文件执行五项单文件检查：花括号平衡、#if/#ifdef/#ifndef 与 #endif 配对、TRACE_POINT 参数语法（event 必须为 "B" 或 "E" 且 label 非空）、MoeTracing 额外实参的作用域回看，以及 #if ENABLE_MOE_PROFILING 守卫块的嵌套/闭合检查。
  - 头文件可达性检查仅针对 op_kernel 目录下的文件：使用 MoeTracing 的文件必须传递包含到基名集合 {fused_deep_moe_base.h, moe_base.h, moe_dispatch_normal_base.h} 之一。另有 kernel 与 op_host 的参数计数一致性检查（warn 级）。配套的 validate_trace_points.py 检查 TRACE_POINT 标签命名风格（小写字母/数字/连字符/空格）与同一标签的 B/E 计数配对，两者不共享代码。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L9–L17
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L9-L17`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L274–L285
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L274-L285`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L138–L168
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L138-L168`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py:L34–L50
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py#L34-L50`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ascend-trace-compile-safety-checker.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L258-L301
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/run_instrumentation_checks.sh:L5-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L2-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L268-L285
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py:L29-L50
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L261-L266
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L141-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L184-L194
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L292-L301
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py:L73-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/run_instrumentation_checks.sh:L1-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L9-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L274-L285
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py:L138-L168
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py:L34-L50
- 源页字段（feature）：ascend-trace-compile-safety-checker
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/run_instrumentation_checks.sh
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/validate_trace_points.py
