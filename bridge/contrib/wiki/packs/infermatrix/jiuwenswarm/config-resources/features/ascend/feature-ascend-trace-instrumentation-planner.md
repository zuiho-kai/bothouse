---
name: feature-ascend-trace-instrumentation-planner
description: generate_instrumentation_plan.py 功能概览：--root/--entry 必填与 -o/--output（默认 instrumentation_plan.json）输出契约、MAX_DEPTH=5/KEYWORDS/HOT_WORDS 常量、入口函数生成插桩计划树（根标签固定 processing，depth_limit 判定先于 helper_merge，HOT_WORDS 豁免 helper 合并但不豁免深度合并）、FUNC_DEF_RE/CALL_RE 正则识别与入口缺失即 SystemExit 的验证入口、iter_code_files→build_call_graph→build_plan 三段数据流
metadata:
  scope: 只收功能概览（CLI 契约、常量、计划树生成行为、取舍、验证入口、数据流）；实现深读（展开细节、extract_block 兜底、main 完整流程）归 feature-depth-ascend-trace-instrumentation-planner-1、feature-depth-ascend-trace-instrumentation-planner-2
---
# 插桩计划生成器（generate_instrumentation_plan.py）

## 现状

- **命令行入口与输出契约**
- 脚本通过 `main()` 提供 CLI：必填 `--root`（算子源码根目录）与 `--entry`（入口函数名），可选 `-o/--output`（默认 `instrumentation_plan.json`）。运行后写出 JSON，包含 `root`、`entry`、`max_depth`（固定 5）和嵌套的 `plan` 树。入口函数不存在时以 `SystemExit("entry function not found: ...")` 退出。脚本自身不修改任何源文件。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L133–L160
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L133-L160`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L1–L5
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L1-L5`）
- **设置与常量**
- 唯一可配置输入是三个 CLI 参数（`--root`、`--entry`、`-o/--output`，默认输出文件名为 `instrumentation_plan.json`）。其余为模块级常量：`MAX_DEPTH = 5` 硬编码最大展开深度；`KEYWORDS` 过滤控制流关键字误判为调用；`HOT_WORDS`（wait/sync/send/recv/copy/quant/dequant）命名热词，含这些词的函数不会被当作低价值 helper 合并。无环境变量或配置文件。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L20–L27
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L20-L27`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L136–L140
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L136-L140`）
- **支持的行为**
- 从指定入口函数生成插桩计划树：根节点标签固定为 `"processing"`（L92），只有子节点标签经 `normalize_label` 由函数名转换（camelCase→kebab、下划线→连字符，L85-L88、L105）。展开时 `depth_limit` 判定先于 `helper_merge`：超出 `MAX_DEPTH=5` 的子节点标 `merged=True, merge_reason="depth_limit"`（L108-L112），未超深度且命中 `is_low_value_helper` 的才标 `helper_merge`（L114-L118）。
  - 含 HOT_WORDS 子串的函数名不视为低价值 helper（L126-L130）。脚本自身不修改源文件（L3-L4）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L91–L118
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L91-L118`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L126–L130
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L126-L130`）
- **设计取舍**
- 函数识别与调用提取全部基于正则（`FUNC_DEF_RE`/`CALL_RE`，L20-L24），无需编译数据库或真解析器，代价是只能覆盖匹配该正则形状的定义，调用边也仅按名字匹配已知名集合（L75-L82）。`MAX_DEPTH=5` 限制展开规模以避免大树，但截断只按深度、不看函数重要性。`HOT_WORDS` 的豁免仅针对 helper 合并这一层：含 wait/sync/quant 等子串的名字不会被 `is_low_value_helper` 折叠（L126-L130），但在深度上限处仍会被 `depth_limit` 合并（L108-L112）；判定用的是名字子串而非函数语义。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L20–L27
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L20-L27`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L106–L130
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L106-L130`）
- **验证入口**
- 所示代码中的运行时校验有：argparse 将 `--root` 与 `--entry` 声明为必填参数（L137-L138），以及构建调用图后检查入口函数是否出现在抽取到的函数名集合中，缺失时以 `SystemExit("entry function not found: ...")` 退出（L148-L149）。本片段为单文件脚本，未附带针对 `build_plan`/`extract_functions` 的测试代码或文档验证说明。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L136–L149
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L136-L149`）
- **职责与数据流：从源码扫描到计划树**
- 单文件 CLI 脚本，职责是只读分析算子源码并产出 JSON 插桩计划，不修改源文件。数据流为三段流水线：`main()` 先用 `iter_code_files` 递归收集 `.h/.hpp/.c/.cc/.cpp` 文件，对每个文件用 `FUNC_DEF_RE` 定位函数定义、`extract_block` 按花括号深度配对提取函数体，并用 `CALL_RE` 收集调用名（剔除控制流关键字），得到 `FuncInfo` 列表（L39-L56、L59-L72）；随后 `build_call_graph` 只保留目标名在已知函数名集合中的边，自调用也被去掉（L75-L82）；
  - 最后 `main` 校验入口函数存在后调用 `build_plan` 从入口做 BFS 展开调用图，构建嵌套计划树并由 `main` 写出 JSON（L91-L123、L148-L159）。展开的终止不只是 `MAX_DEPTH=5`：已见的 `(fn, child, depth)` 边会被跳过，超过深度上限的子节点被标记 `merged=True, merge_reason="depth_limit"` 后不再入队，命中 `is_low_value_helper` 的子节点标 `helper_merge` 后同样不再展开（L96-L121）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L44–L56
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L44-L56`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L59–L72
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L59-L72`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L91–L123
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L91-L123`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L148–L159
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L148-L159`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ascend-trace-instrumentation-planner.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L133-L160
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L1-L5
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L20-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L136-L140
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L91-L118
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L126-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L106-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L136-L149
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L44-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L59-L72
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L91-L123
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L148-L159
- 源页字段（feature）：ascend-trace-instrumentation-planner
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py
