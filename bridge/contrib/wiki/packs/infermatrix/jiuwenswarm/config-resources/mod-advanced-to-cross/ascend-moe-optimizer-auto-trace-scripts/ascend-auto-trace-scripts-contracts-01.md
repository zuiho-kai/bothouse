---
name: ascend-auto-trace-scripts-contracts-01
description: ascend-moe-optimizer-auto-trace-scripts 源码接口记录 01（ascend-moe-optimizer-auto-trace-scripts 脚本共两页之一）：覆盖 apply_trace_scaffold.sh、bootstrap_trace_toolchain.py、check_compile_safety.py、generate_instrumentation_plan.py、inspect_rank_pt.py、instrument_operator.py、patch_build_pipeline.py、trace_collector.py 等共 11 个文件
metadata:
  scope: 只收 ascend-moe-optimizer-auto-trace-scripts 下这 11 个源文件的逐文件接口记录；本目录入口归 ascend-auto-trace-scripts-overview，其余文件的接口记录归 ascend-auto-trace-scripts-contracts-02
---
# ascend-moe-optimizer-auto-trace-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh`**
- 脚本执行边界：`python3 "${SKILL_ROOT}/scripts/bootstrap_trace_toolchain.py" --build-dir "${BUILD_DIR}"`；`python3 "${SKILL_ROOT}/scripts/patch_build_pipeline.py" \`；`python3 "${SKILL_ROOT}/scripts/verify_trace_scaffold.py" \`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh#L1-L33)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/bootstrap_trace_toolchain.py`**
- 源码对模块职责的说明：Deploy the trace toolchain Python scripts into a target build directory (flat layout).。
- 调用入口 `deploy_file(src, dst, force, dry_run)`；声明返回 `tuple[str, bool]`。
- 调用入口 `main()`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import shutil`。
- 模块级配置或常量名称：`SCRIPT_DIR`, `TOOLCHAIN_FILES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/bootstrap_trace_toolchain.py#L1-L124)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py`**
- 源码对模块职责的说明：Static compile-safety checker for MoeTracing instrumentation.。
- `CheckResult` 定义类型边界；方法入口：`__init__`, `error`, `warn`, `ok`。
- 调用入口 `read_lines(path)`；声明返回 `List[str]`。
- 调用入口 `strip_comments_and_strings(line)`；声明返回 `str`。
- 调用入口 `check_brace_balance(path, lines, result)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import re`。
- 模块级配置或常量名称：`COMMENT_LINE`, `STRING_LITERAL`, `MOETRACING_CALL`, `TRACE_POINT_RE`, `MOETRACING_FULL`, `INCLUDE_RE`, `COMMON_LOOP_VARS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/check_compile_safety.py#L1-L305)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py`**
- 源码对模块职责的说明：Generate a function-level instrumentation plan (max depth=5) for Ascend operator code. This script does not modify source files.。
- `FuncInfo` 定义类型边界。
- 调用入口 `iter_code_files(root)`；声明返回 `List[pathlib.Path]`。
- 调用入口 `extract_functions(path)`；声明返回 `List[FuncInfo]`。
- 调用入口 `extract_block(text, open_brace_idx)`；声明返回 `Tuple[str, int]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 模块级配置或常量名称：`FUNC_DEF_RE`, `CALL_RE`, `KEYWORDS`, `HOT_WORDS`, `MAX_DEPTH`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L1-L164)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/inspect_rank_pt.py`**
- 源码对模块职责的说明：Inspect rank*.pt produced by save_profiling_data: shapes, counters, sample trace IDs.。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import logging`；`import os`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/inspect_rank_pt.py#L1-L90)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py`**
- 源码对模块职责的说明：Apply TRACE_POINT instrumentation to operator source files with function-level granularity. Rules: - Root label defaults to 'processing' - Max depth defaults to。
- `FunctionBlock` 定义类型边界。
- 调用入口 `find_functions(text)`；声明返回 `List[FunctionBlock]`。
- 调用入口 `find_match_brace(text, open_idx)`；声明返回 `int`。
- 调用入口 `normalize_label(func_name)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import pathlib`。
- 模块级配置或常量名称：`FUNC_RE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/instrument_operator.py#L1-L128)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py`**
- 源码对模块职责的说明：Patch compile/build script to inject trace preprocessor command. Idempotent by marker comments.。
- 调用入口 `inject_hook(script_text, cmd)`；声明返回 `str`。
- 调用入口 `main()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import re`。
- 模块级配置或常量名称：`START_MARK`, `END_MARK`, `ANCHOR_PATTERNS`, `FALLBACK_PATTERN`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py#L1-L85)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py`**
- 源码对模块职责的说明：从 rank*.pt 和 point_map.json 生成 Chrome Trace JSON。 支持 64 位组合 ID 解析、B/E 配对、区间深度过滤。。
- 调用入口 `extract_point_id_parts(combined_id)`；声明返回 `Tuple[int, int]`。
- 调用入口 `parse_profiling_data(tensor, core_type, core_id)`；声明返回 `List[Dict]`。
- 调用入口 `load_all_ranks(data_dir)`；声明返回 `Dict[int, List[Dict]]`。
- 调用入口 `load_mapping(path)`；声明返回 `Dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import glob`；`import json`；`import logging`；`import os`。
- 模块级配置或常量名称：`CLOCK_DIVISOR`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L1-L404)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py`**
- 源码对模块职责的说明：TRACE_POINT 预处理器：扫描源码中的 TRACE_POINT("label", "B/E")， 为每个调用分配唯一 point_id（int32），替换源码后生成 point_map.json 映射表。 支持事件 ID 分配、嵌套校验、映射表导出。。
- `TracePreprocessor` 定义类型边界；方法入口：`__init__`, `process_file`, `process_directory`, `save_mappings`。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import json`；`import logging`；`import os`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L1-L139)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_save.py`**
- 源码对模块职责的说明：加载原始 profiling tensor（.pt），调用 trace_utils 按核类型拆分并保存。。
- 调用入口 `main()`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import logging`；`import torch`；`from trace_utils import save_profiling_data`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_save.py#L1-L26)。
- **`jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py`**
- 源码对模块职责的说明：Profiling 数据工具集：从 base.h 读取宏配置、核类型映射、profiling tensor 拆分保存。。
- 调用入口 `get_define_value_from_file(filepath, macro_name)`。
- 调用入口 `get_define_value_from_base(macro_name, base_h_path)`。
- 调用入口 `get_prof_size_per_core(base_h_path)`；声明返回 `int`。
- 调用入口 `get_enable_moe_profiling(base_h_path)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import os`；`import re`；`from typing import Callable, List, Optional`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py#L1-L149)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/ascend-moe-optimizer-auto-trace-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
