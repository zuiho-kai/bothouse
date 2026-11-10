---
name: feature-depth-ascend-trace-instrumentation-planner-2
description: 插桩计划生成器实现深读第 2 部分：入口缺失即 SystemExit、extract_block 未配平花括号时回退到文件末尾、seen_edges 三元组去重防循环、MAX_DEPTH 与 helper 合并控制计划规模的取舍（深层函数与简单 helper 不再单独展开）、main 从提取函数到 BFS 展开写出 JSON 的完整流程、reference.md 记载的文档化手动流程（未执行）
metadata:
  scope: 只收入口缺失处理、extract_block 兜底、取舍与 main 完整流程、未执行的手动验收记录；CLI 接口与深度常量归 feature-depth-ascend-trace-instrumentation-planner-1
---
# 插桩计划生成器（调用图深度受限展开）：实现深读（2/2）

## 现状

- 拆分说明：本页是源页 `feature-depth-ascend-trace-instrumentation-planner.md` 的第 2/2 部分；第 1 部分 [[feature-depth-ascend-trace-instrumentation-planner-1]]
- **入口缺失即 SystemExit；未闭合函数体回退为剩余文本** 触发一：args.entry 不在扫描到的函数名集合时 raise SystemExit(f"entry function not found: {args.entry}")，进程终止、不写输出文件。触发二：extract_block 扫描到文本末尾仍未配平花括号时返回从开括号到文件末尾的剩余文本（含 n-1 结束索引），即解析容错而非报错。循环边由 seen_edges 的 (fn, c, depth) 三元组去重防止重复展开。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L148–L149
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L148-L149`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L59–L72
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L59-L72`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L98–L103
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L98-L103`）
- **深度上限与 helper 合并控制计划规模，代价是深层函数与简单 helper 不再单独展开** 设计推断（非作者历史意图）：
- 收益（推理标注）：MAX_DEPTH 与 (fn,c,depth) 去重共同限定 BFS 展开规模，保证输出有界。成本：depth+1 > MAX_DEPTH 的子节点只保留 merged 标记不再展开；is_low_value_helper 把不含 HOT_WORDS 且以 get/set/check/calc/init 开头、长度 ≤18 的函数名直接合并（merge_reason="helper_merge"），不考察其内部调用。另注：脚本头部声明不修改源文件。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L108–L118
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L108-L118`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L126–L130
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L126-L130`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L1–L5
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L1-L5`）
- **main 从源码提取函数后由 build_plan 做 BFS 展开并写出 JSON 计划** main 解析必填的 --root/--entry 后，iter_code_files 递归收集 .h/.hpp/.c/.cc/.cpp 文件，extract_functions 用 FUNC_DEF_RE 定位定义、把函数体提取委托给 extract_block（L53）、用 CALL_RE 收集调用名（剔除 KEYWORDS）；
  - build_call_graph 之后若入口名不在提取到的函数名集合中则 SystemExit，否则 build_plan 从入口按队列 BFS 展开：已见 (fn, child, depth) 边跳过，超过 MAX_DEPTH 的子节点标 merged=True、merge_reason="depth_limit" 后不再入队，命中 is_low_value_helper（名称不含 HOT_WORDS、以 get/set/check/calc/init 开头且长度 ≤18）的子节点标 helper_merge 后同样不再展开；
  - 最终结果连同 root/entry/max_depth 以 indent=2 写入 args.output（默认 instrumentation_plan.json）。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L39–L56
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L39-L56`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L91–L123
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L91-L123`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L126–L130
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L126-L130`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L133–L160
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L133-L160`）
- **文档化手动流程：运行 generate_instrumentation_plan.py 产出插桩草案（未执行）** 文档中的人工验收步骤（本轮未执行）：
- reference.md L469 将该脚本列为步骤 1–4 的可选辅助（"规划/草稿插桩，不能替代人工审查"），L476 给出命令 `python <skill_root>/scripts/generate_instrumentation_plan.py --root <operator_dir> --entry <entry_function>`，描述的预期结果是生成打点草案（函数树 + 合并决策）。此为文档记载的手动流程，本回答未执行；所示代码片段中未附带针对 build_plan/extract_functions 的自动化测试。NOT EXECUTED。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L469–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md#L469-L477),
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L136–L149
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L136-L149`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ascend-trace-instrumentation-planner.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
