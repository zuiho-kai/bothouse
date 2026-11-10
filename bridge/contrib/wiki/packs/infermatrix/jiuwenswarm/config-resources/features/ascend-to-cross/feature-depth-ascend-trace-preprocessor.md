---
name: feature-depth-ascend-trace-preprocessor
description: trace_preprocessor 实现深读：process_file 按行号排序分配递增 point_id 并在 --modify 时按位置倒序原地替换 TRACE_POINT 调用、main 接受 src/output/--modify 且仅在匹配点非空时才调用 save_mappings、apply_trace_scaffold.sh 经 patch_build_pipeline.inject_hook 用 START/END 标记注入预处理命令、纯正则文本匹配只识别双引号参数形式且无匹配时静默跳过的取舍、reference.md 记载的 --modify 手动运行命令与 point_map.json 输出结构（未执行）
metadata:
  scope: 只收实现深读（process_file/main 行为、集成调用链、取舍、未执行的手动验收记录）；功能概览归 feature-ascend-trace-preprocessor
---
# TRACE_POINT 预处理器与 point_map 映射导出：实现深读

## 现状

- [[feature-ascend-trace-preprocessor]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **process_file 在 modify 模式下用 point_id 原地替换 TRACE_POINT 调用** `process_file` 以正则匹配每个 `TRACE_POINT("标签", "类型")`,按行号排序后分配递增 point_id;当 `modify=True` 且有匹配点时,按 start 位置倒序把每处调用文本替换为数字 point_id 并回写源文件(UTF-8),随后 `save_mappings` 把 `point_map` 以 `output_dir` 相对路径写入 `point_map.json`。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L32–L43
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L32-L43`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L77–L85
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L77-L85`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L95–L106
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L95-L106`）
- **main 接受 src、output 位置参数与可选 --modify,有匹配点时才导出映射** CLI 契约:`src`(文件或目录)、`output`(point_map.json 输出目录)、`--modify`(store_true,替换源文件中的 TRACE_POINT)。src 为文件走 `process_file`,为目录走 `process_directory`;仅当返回的匹配点列表非空时调用 `save_mappings`,因此无 TRACE_POINT 时不会生成映射文件。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L115–L135
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L115-L135`）
- **modify 默认关闭，--modify 开启源码改写；仅当发现点时导出映射** process_file/process_directory 的 modify 默认 False（只扫描不改写）；CLI 用 --modify（store_true）开启替换。main 仅在返回的点列表非空时调用 save_mappings。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L28–L28
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L28-L28`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L87–L93
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L87-L93`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L121–L135
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L121-L135`）
- **apply_trace_scaffold.sh 调用 patch_build_pipeline 注入 trace_preprocessor 命令** patch_build_pipeline.inject_hook 把 --preprocessor-cmd 文本插入编译脚本（用 START/END 标记包裹）；apply_trace_scaffold.sh 以占位的 trace_preprocessor.py ... --modify 命令调用它，并注明该命令需按仓库实际变量名修改。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py:L54–L59
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py#L54-L59`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L20–L26
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh#L20-L26`）
- **纯正则文本匹配：无需语法解析，但只识别两个双引号参数的特定文本形式且无匹配时静默跳过** 设计推断（非作者历史意图）：
- L32 的正则仅按文本形式匹配 TRACE_POINT 后两个由双引号括起的非引号字符序列；无匹配时 L34-35 直接返回 [] 且不告警。推断：收益是无需 C/C++ 语法解析即可替换打点，代价是宏生成或其它书写形式的打点会被静默漏检。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L32–L35
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L32-L35`）
- **文档化手工流程：以 --modify 运行 trace_preprocessor.py 生成含 label/event_type/file/line/event_id 的 point_map.json（未执行）** 文档中的人工验收步骤（本轮未执行）：
- reference.md 记录的手工步骤：python <skill_root>/scripts/trace_preprocessor.py <operator_src_dir> <output_dir> --modify，预期输出 point_map.json，其 points 以 point_id 为键，每项含 label、event_type、file、line、event_id。此为已记录的手工流程，本次 NOT EXECUTED，未声称任何运行时或自动化测试覆盖。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L337–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md#L337-L348)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ascend-trace-preprocessor.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L32-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L77-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L95-L106
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L115-L135
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L28-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L87-L93
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L121-L135
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py:L54-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L20-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L32-L35
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/reference.md:L337-L348
- 源页字段（feature）：ascend-trace-preprocessor
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py
