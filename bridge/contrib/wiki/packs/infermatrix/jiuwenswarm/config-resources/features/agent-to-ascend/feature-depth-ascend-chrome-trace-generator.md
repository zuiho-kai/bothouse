---
name: feature-depth-ascend-chrome-trace-generator
description: trace_collector 实现深读：main() 解析参数并生成 trace 的流程、data_dir/mapping_file 位置参数与可选项、point_map 缺失或 all_data 为空时的错误处理、trace_collector 与 trace_utils 的 torch.save/load 文件耦合、模块级可变全局 CLOCK_DIVISOR 的取舍、reference.md 记载的手动运行命令（未执行）
metadata:
  scope: 只收实现深读（main 流程、CLI 契约、错误路径、依赖耦合、CLOCK_DIVISOR 取舍、未执行的手动验收记录）；功能概览归 feature-ascend-chrome-trace-generator
---
# Chrome Trace JSON 生成器（trace_collector）：实现深读

## 现状

- [[feature-ascend-chrome-trace-generator]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main(): 解析参数后加载 rank 数据与 point_map，生成 chrome trace** main() 配置日志、解析 CLI 参数，将 CLOCK_DIVISOR 设为 args.clock_divisor；load_all_ranks 读取 data_dir，若为空记录错误并 return；否则加载 mapping、打印诊断信息并调用 generate_chrome_trace(all_data, mapping, args.output, args.extra_mode, args.depth)。仅在 __main__ 时执行。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L367–L404
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L367-L404`）
- **位置参数 data_dir 与 mapping_file，可选 -o/--output 等 CLI 契约** CLI 需要两个位置参数：data_dir（含 rank*.pt 的目录）与 mapping_file（预处理器的 point_map.json）；可选项 -o/--output、--clock-divisor、--extra-mode（choices=["legacy","seq"]）、--depth。调用方需先产生 rank*.pt 与 point_map.json 才能运行。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L372–L379
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L372-L379`）
- **默认 output=chrome_trace.json、clock-divisor=50.0、extra-mode=seq、depth=0** argparse 默认值：--output 默认 "chrome_trace.json"，--clock-divisor 默认 50.0（MHz 时钟频率），--extra-mode 默认 "seq"（仅允许 legacy/seq），--depth 默认 0 表示不过滤（0=all）。CLOCK_DIVISOR 全局变量在解析后被赋为该值。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L375–L382
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L375-L382`）
- **缺失 point_map 文件会记录错误并返回空字典；空 rank 数据会中止主程序** 如果路径不存在，load_mapping 会记录 'ERROR: point_map not found' 并返回 {}；如果 JSON 不是字典，它会记录 'point_map must be a JSON object' 并返回 {}。在 main 中，当 all_data 为空时会记录 'No rank*.pt files found' 并返回，不再进行后续生成。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L78–L88
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L78-L88`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L384–L387
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L384-L387`）
- **trace_collector 导入 torch 并以 data_dir 中 rank*.pt 文件为输入** trace_collector.py 导入 torch，CLI 接受包含 rank*.pt 文件的 data_dir 并传给 load_all_ranks；配套 trace_utils.py 用 torch.save 写出 rank{rank_id:03d}.pt，即两侧通过该 torch 序列化文件格式耦合（未显示加载实现细节）。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L15–L15
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L15-L15`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L373–L387
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L373-L387`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py:L143–L149
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py#L143-L149`）
- **cycle→us 换算用可变模块全局 CLOCK_DIVISOR（默认 50.0，可被 --clock-divisor 覆盖）** 设计推断（非作者历史意图）：
- 默认 50.0（MHz），main 里通过 global 把 --clock-divisor 赋给 CLOCK_DIVISOR；换算处直接 diff / CLOCK_DIVISOR。收益是适配不同时钟频率；代价（推断）是可变模块全局让换算结果依赖解析 argv 的执行顺序。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L19–L19
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L19-L19`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L46–L48
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L46-L48`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L376–L382
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py#L376-L382`）
- **记录的手动流程：运行 trace_collector.py 生成 chrome_trace.json（未执行）** 文档中的人工验收步骤（本轮未执行）：
- reference.md 记录了手动命令 `python <skill_root>/scripts/trace_collector.py profiling_data point_map.json -o chrome_trace.json`，读取 rank*.pt 与 point_map.json 并生成 Chrome Trace 格式输出；文档还列出可选参数 --clock-divisor 50.0（时钟 MHz）、--extra-mode seq、--depth 0。此为文档记载的操作与预期结果，明确标注未执行（NOT EXECUTED），不据此断言任何测试已通过。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L371–L382](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md#L371-L382)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ascend-chrome-trace-generator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L367-L404
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L372-L379
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L375-L382
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L78-L88
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L384-L387
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L15-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L373-L387
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py:L143-L149
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L19-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L46-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py:L376-L382
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L371-L382
- 源页字段（feature）：ascend-chrome-trace-generator
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_collector.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_save.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_utils.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/inspect_rank_pt.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/bootstrap_trace_toolchain.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/verify_trace_scaffold.py
