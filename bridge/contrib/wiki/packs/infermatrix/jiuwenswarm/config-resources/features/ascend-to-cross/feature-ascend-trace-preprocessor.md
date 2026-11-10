---
name: feature-ascend-trace-preprocessor
description: trace_preprocessor.py 功能概览：几乎无配置（唯一开关 --modify，output 位置参数决定 point_map.json 落盘路径）、apply_trace_scaffold.sh 中预处理命令模板需按仓库变量改写的集成期配置点、verify_trace_scaffold.py 作为集成层验证入口与 patch_build_pipeline.py 的幂等 marker、src/output/--modify CLI 与公开方法契约、event_map/point_map/point_to_event 跨文件数据流与 point_id 上限 0xFFFFFFFF
metadata:
  scope: 只收功能概览（配置项、集成验证入口、CLI 契约、数据流、取舍）；实现深读（process_file 替换细节、main 导出条件、apply_trace_scaffold.sh 调用链）归 feature-depth-ascend-trace-preprocessor
---
# TRACE_POINT 预处理器与 point_map 映射导出（ascend-moe-optimizer-auto-trace skill）

## 现状

- **可配置项**
- 工具本身几乎没有配置项：唯一的开关是 `--modify`（替换源码中的 TRACE_POINT 调用），默认只扫描不改写；`output` 位置参数决定 point_map.json 的落盘位置，文件路径会写成相对该目录的相对路径。注入到编译脚本的预处理命令模板在 `apply_trace_scaffold.sh` 中被明确标注为“示意占位符”，需要使用者按自己仓库的变量名（如 SCRIPTS_PATH、BUILD_OUT_PATH、proj_name）改写，这是主要的集成期配置点。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L120–L124
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L120-L124`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L20–L26
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh#L20-L26`）
- **验证入口**
- 所示的验证入口是集成层面的 `verify_trace_scaffold.py`：`apply_trace_scaffold.sh` 在部署工具链并 patch 编译脚本后调用它（参数 --build-dir、--compile-script）确认脚手架就位；`patch_build_pipeline.py` 自身通过 START/END marker 实现幂等并在重复运行时输出 "no change (hook already exists)"。trace_preprocessor.py 的单元测试未在所示文件中出现。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L28–L33
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh#L28-L33`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py:L32–L34
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py#L32-L34`）
- **CLI 与公开方法**
- trace_preprocessor.py 提供 CLI：`src`（源文件或目录）、`output`（point_map.json 输出目录）、可选 `--modify`（改写源文件）。main 在 src 既不是文件也不是目录时记录错误并以退出码 1 结束；仅在本次运行收集到至少一个点时才调用 save_mappings（这是 main 的行为，save_mappings 本身被调用时无条件写文件，包括空映射）。TracePreprocessor.process_file 对每个匹配返回点信息；当 point_id 超过上限 0xFFFFFFFF 时记录错误并返回空列表。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L115–L135
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L115-L135`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L53–L57
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L53-L57`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L95–L106
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L95-L106`）
- **职责与数据流**
- TracePreprocessor 维护跨文件共享的 event_map（label→event_id）、point_map（point_id→元数据）和 point_to_event；process_directory 用 os.walk 遍历 C/C++ 源文件并逐个调用 process_file。每个 TRACE_POINT("label","B/E") 匹配按处理顺序递增分配 point_id（上限 0xFFFFFFFF，使用 Python int，并非严格的有符号 int32），相同 label 复用同一 event_id；
  - --modify 时从后向前把调用替换为 point_id 数字，避免偏移失效。save_mappings 把 point_map 写成 point_map.json，键为字符串化的 point_id，文件路径存为相对输出目录的路径。集成侧由 apply_trace_scaffold.sh 串联 bootstrap、patch_build_pipeline.py（把预处理命令注入编译脚本）和 verify_trace_scaffold.py。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L20–L26
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L20-L26`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L48–L66
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L48-L66`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L87–L106
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L87-L106`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L17–L31
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh#L17-L31`）
- **支持的行为**
- 工具可独立运行：直接对一个文件或目录扫描 TRACE_POINT 并导出 point_map.json（含 label、文件、行号、event_type、event_id），--modify 时改写源码；apply_trace_scaffold.sh/patch_build_pipeline 只是可选的脚手架集成方式，不是必要依赖。嵌套校验按文档字符串宣称支持（L3–L5），但实现（L68–L75）只对 B/E 做栈匹配，未匹配的 E 或残留的 B 不产生任何失败信号。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L115–L135
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L115-L135`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L68–L75
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L68-L75`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L23–L31
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh#L23-L31`）
- **取舍**
- Inference / 设计推断（非作者历史意图）：
- 识别采用正则 TRACE_POINT\s*\(...\) 而非语法解析（L32–L43），实现简单但只覆盖双字符串字面量形式；替换采用按位置逆序替换以保持偏移有效（L77–L83）。ID 分配依赖处理顺序：process_directory 用未排序的 os.walk/files 遍历（L89–L92），跨文件的 point_id 顺序随遍历顺序而定，未在所示代码中保证稳定。这些是对所示实现的描述；无文档说明作者动机。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L32–L43
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L32-L43`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L77–L83
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L77-L83`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L89–L92
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py#L89-L92`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ascend-trace-preprocessor.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L120-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L20-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L28-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py:L32-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L115-L135
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L53-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L95-L106
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L20-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L48-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L87-L106
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L17-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L68-L75
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh:L23-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L32-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L77-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py:L89-L92
- 源页字段（feature）：ascend-trace-preprocessor
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/trace_preprocessor.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/apply_trace_scaffold.sh
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-auto-trace/scripts/patch_build_pipeline.py
