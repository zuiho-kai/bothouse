---
name: feature-depth-ascend-trace-instrumentation-planner-1
description: 插桩计划生成器实现深读第 1 部分：--root/--entry 必填与 -o/--output 默认值的 CLI 接口、MAX_DEPTH=5 固定展开深度（无命令行覆盖，子节点 depth=min(depth+1, MAX_DEPTH)）、仅依赖标准库且调用图只按已提取函数名匹配（未知调用名不建边）
metadata:
  scope: 只收 CLI 接口、深度常量与调用图匹配三个侧面；入口缺失处理、取舍与 main 完整流程归 feature-depth-ascend-trace-instrumentation-planner-2
---
# 插桩计划生成器（调用图深度受限展开）：实现深读（1/2）

## 现状

- 拆分说明：本页是源页 `feature-depth-ascend-trace-instrumentation-planner.md` 的第 1/2 部分；第 2 部分 [[feature-depth-ascend-trace-instrumentation-planner-2]]
- [[feature-ascend-trace-instrumentation-planner]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **命令行接口：--root 与 --entry 必填，-o/--output 默认 instrumentation_plan.json** 脚本是独立 CLI（argparse）：--root 指定算子源码根目录、--entry 指定入口函数名，二者 required；-o/--output 默认 "instrumentation_plan.json"。成功时写出缩进 2 的 JSON，顶层键为 root（解析后的绝对路径字符串）、entry、max_depth（固定 5）、plan；
  - 入口不存在时以非零方式 SystemExit 并输出 "entry function not found: {entry}"。调用方需保证 root 是可读目录。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L136–L140
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L136-L140`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L148–L159
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L148-L159`）
- **展开深度由常量 MAX_DEPTH=5 固定，无命令行覆盖项** 深度上限是模块级常量 MAX_DEPTH = 5，输出 JSON 的 max_depth 字段记录该值；CLI 未提供调整参数。子节点 depth 记为 min(depth+1, MAX_DEPTH)，当 depth+1 > MAX_DEPTH 时子节点标记 merged=True、merge_reason="depth_limit" 且不再入队。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L27–L27
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L27-L27`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L106–L112
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L106-L112`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L139–L139
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L139-L139`）
- **仅依赖标准库；调用图按已提取的裸函数名匹配，未知调用名不建边** 脚本只 import argparse/json/logging/pathlib/re 及标准集合/dataclass/typing，无第三方依赖。build_call_graph 把每个函数 calls 中出现在已知函数名集合且非自调用的名字加入边；因此只有与提取到的函数名相同的调用字符串才会形成图边。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L7–L18
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L7-L18`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L75–L82
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py#L75-L82`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ascend-trace-instrumentation-planner.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L136-L140
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L148-L159
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L27-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L106-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L139-L139
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L148-L149
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L59-L72
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L98-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L108-L118
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L126-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L1-L5
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L7-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L75-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L39-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L91-L123
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L133-L160
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L469-L477
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py:L136-L149
- 源页字段（feature）：ascend-trace-instrumentation-planner
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/generate_instrumentation_plan.py
