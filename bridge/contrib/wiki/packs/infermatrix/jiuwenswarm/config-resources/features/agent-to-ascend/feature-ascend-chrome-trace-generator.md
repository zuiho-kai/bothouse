---
name: feature-ascend-chrome-trace-generator
description: trace_collector Chrome Trace JSON 生成器功能概览：load_all_ranks/parse_profiling_data/generate_chrome_trace 四段数据流、-o/--clock-divisor/--extra-mode/--depth 配置、main() 调用契约、seq/legacy 两种 B/E 配对模式、depth 过滤的 O(n²) 区间树代价
metadata:
  scope: 只收功能概览（数据流、配置项、入口契约、B/E 配对模式、深度过滤代价）；main() 实现细节、point_map 缺失等错误路径与手动验收记录归 feature-depth-ascend-chrome-trace-generator
---
# Chrome Trace JSON 生成器（trace_collector）

## 现状

- **数据流与处理阶段**
- 流水线分四段：(1) load_all_ranks 用 glob 按文件名解析 rank id，torch.load 每个由 trace_utils.save_profiling_data 产出的按核类型分组的 tensor 列表；
  - (2) parse_profiling_data 按核读取记录——tensor[core,0] 是计数器（记录数 = 计数 - 1），ID 自 [1+i] 正向、时间戳自 [-2-i] 反向读取，与首时间戳 [-1] 做无符号差后除以 CLOCK_DIVISOR 得微秒；组合 ID 拆为低 32 位 base_point_id 与高 32 位 extra_id（均按补码转有符号）。
  - (3) generate_chrome_trace 按 (rank, core_type, core_id) 生成 pid/tid 元数据，做 B/E 配对与深度过滤；
  - (4) 写出 {traceEvents, displayTimeUnit:'us', otherData:{统计与参数}}。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L32–L55
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L32-L55`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L22–L29
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L22-L29`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L338–L352
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L338-L352`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py:L124–L148
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py#L124-L148`）
- **配置项与默认值**
- 命令行配置：`-o/--output`（默认 chrome_trace.json）、`--clock-divisor`（float，默认 50.0，即 MHz，cycle→us；赋给模块级 CLOCK_DIVISOR）、`--extra-mode`（legacy|seq，默认 seq）、`--depth`（int，默认 0 = 不过滤；非 0 时按 depth_from_leaf <= depth 保留区间）。
  - 上游 trace_utils 还受环境变量 MOE_USE_1C2V（默认 "0"；为 "1" 时核数列表从 [24,48] 变为 [24,24,24] 并改用 1c2v 核映射）以及 base.h 宏 PROF_SIZE_PER_CORE（默认 2048）和 ENABLE_MOE_PROFILING 影响。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L372–L382
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L372-L382`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py:L71–L85
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py#L71-L85`）
- **入口与调用契约**
- 公开入口是命令行 `main()`：位置参数 `data_dir`（含 rank*.pt 的目录）与 `mapping_file`（point_map.json），选项 `-o/--output`（默认 chrome_trace.json）、`--clock-divisor`、`--extra-mode`、`--depth`。主流程为 load_all_ranks → （空则报错并提前 return）→ load_mapping → diagnose_mapping_overlap → generate_chrome_trace。
  - generate_chrome_trace 也可作为库函数直接调用，返回写出的 trace 字典。错误契约：load_all_ranks 对单个 .pt 加载失败仅告警跳过；load_mapping 对文件缺失或非对象结构返回 {}，但 open/json.load 未捕获异常，损坏 JSON 会直接抛出。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L367–L400
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L367-L400`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L58–L90
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L58-L90`）
- **现有验证入口**
- verify_trace_scaffold.py 检查构建目录是否包含 trace_preprocessor/trace_utils/trace_save/trace_collector 四个必需脚本，缺文件时退出码 1；可选 --compile-script 检查编译脚本是否含 TRACE_PREPROCESSOR_HOOK_START/END 钩子标记。运行期诊断：generate_chrome_trace 结束时若 skipped_no_mapping>0 发出警告，统计写入 otherData；
  - diagnose_mapping_overlap 仅当 rank*.pt 中的唯一 id 集合与 point_map 键集合均非空且交集为空时，才提示 point_map.json 与内核构建不匹配、应改用同一 ascend_kernels_*_proj 目录编译进 OPP 的 point_map.json，并输出双方样本 id。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/verify_trace_scaffold.py:L14–L54
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/verify_trace_scaffold.py#L14-L54`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L104–L125
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L104-L125`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L338–L363
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L338-L363`）
- **B/E 配对的两种模式**
- generate_chrome_trace 按 (rank, core_type, core_id) 分组、再按 base_name 分组后做 B/E 配对，有两种模式。seq 模式（默认）：每个 B 事件在同一 base_name 组内按时间顺序向后查找第一个 seq（extra_id 高 24 位）相同的 E 事件，找到则组成区间并将外层下标直接推进到该 E 之后——位于 B 与匹配 E 之间的中间记录既不配对也不进入 unpaired；未找到匹配 E 的 B 以及先于任何 B 出现的 E 记为 unpaired。
  - legacy 模式：用 deque 做 FIFO 配对，每个 B 依入队顺序取得递增编号，多余的 E 标为 #-1、剩余未闭合的 B 也进入 unpaired。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L250–L286
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L250-L286`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L287–L319
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L287-L319`）
- **深度过滤的区间树代价**
- 当 depth 参数非 0 时，generate_chrome_trace 对每个线程的全部已配对区间调用 build_interval_tree 计算嵌套深度，再只保留 depth_from_leaf <= depth 的区间（unpaired 事件不受过滤影响，始终输出）。代价：build_interval_tree 对每个区间在全部区间上做二次扫描确定父节点（候选父须满足 oth.s <= cur.s 且 oth.e >= cur.e 且时长严格大于当前区间），随后 DFS 求深度，单线程内为 O(n²)；depth 为 0 时跳过整棵树的构建，直接输出所有区间。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L128–L162
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L128-L162`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L321–L336
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L321-L336`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ascend-chrome-trace-generator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L32-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L22-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L338-L352
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py:L124-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L372-L382
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py:L71-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L367-L400
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L58-L90
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/verify_trace_scaffold.py:L14-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L104-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L338-L363
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L250-L286
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L287-L319
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L128-L162
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L321-L336
- 源页字段（feature）：ascend-chrome-trace-generator
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_save.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/inspect_rank_pt.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/bootstrap_trace_toolchain.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/verify_trace_scaffold.py
