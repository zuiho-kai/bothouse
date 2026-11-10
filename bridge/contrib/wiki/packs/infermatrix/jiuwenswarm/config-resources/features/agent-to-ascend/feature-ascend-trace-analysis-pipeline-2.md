---
name: feature-ascend-trace-analysis-pipeline-2
description: ascend-moe-optimizer-trace-analyzer app.py 概览第 2 部分：validate_inputs 存在性检查与 log_run_summary 日志、--trace 等 CLI 参数与 phase map 加载（PyYAML/自研解析器）、parse_trace_json→PhaseMapper→九张汇总表的主流程与诊断支路
metadata:
  scope: 只收该功能概览的后半（入口存在性检查与运行结束日志、CLI 参数与 phase map 加载、主流程）；核组归因与 CLI 入口契约见 feature-ascend-trace-analysis-pipeline-1；实现深读归 feature-depth-ascend-trace-analysis-pipeline
---
# ascend-moe-optimizer-trace-analyzer CLI 主流程（2/2）

## 现状

- 拆分说明：本页是源页 `feature-ascend-trace-analysis-pipeline.md` 的第 2/2 部分；第 1 部分 [[feature-ascend-trace-analysis-pipeline-1]]
- **入口存在性检查与运行结束日志**
- 运行前的显式校验只有 `validate_inputs` 的两个文件存在性检查（trace 与 phase map），缺失即抛 `FileNotFoundError`，所示代码中没有对输出产物的一致性回读。
  - 运行结束后 `log_run_summary` 在 INFO 级别记录 overview 计数（实例数、phase/name/pid/tid 数、核组、wall time）、diagnosis headline，以及 phase/category 摘要的前 10 行和全部 core group 行（core_group_summary 本身按 cube/vector_recv/vector_send 的固定组序排列，不是按 union_us 全局排序），仅作日志呈现，不构成第二次校验。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L94–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L94-L99),
  - [jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L172–L182](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L172-L182),
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L365–L365
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py#L365-L365`）
- **CLI 参数与 phase map 加载**
- CLI 仅 --trace 必填；可选 --phase-map（默认 config/phase_map.yaml）、--output-dir（默认 output）、--top-n（默认 20，控制报告与图表行数）、--llm-analysis（开关）、--llm-command（默认 None）、--llm-timeout（默认 120 秒）。命令解析优先取显式 --llm-command，否则回退环境变量 TRACE_ANALYSIS_LLM_CMD；
  - 命令经 shlex.split 拆分，若拆分结果为空 argv（例如仅空白字符串，此时 `command or env` 为真值、不再回退环境变量）则返回 not_configured 状态。phase map 加载优先用 PyYAML 的 safe_load，PyYAML 缺失时退回一个只支持固定缩进结构的自研 YAML 子集解析器。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L50–L91](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L50-L91),
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L171–L185
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py#L171-L185`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L224–L250
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py#L224-L250`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/phase_mapper.py:L70–L87
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/phase_mapper.py#L70-L87`）
- **主流程：解析、映射、九张汇总表与诊断支路**
- main() 按固定顺序组织数据流：parse_trace_json 统一解析 Chrome JSON 的 ph=='X' 完整事件与 B/E 栈配对事件（按 pid/tid/name 配对，孤立或时间反常的丢弃）；PhaseMapper 用 YAML phase 规则把事件名映射为 phase；build_phase_instances 只保留成功映射的区间行并派生 category/core_group 等字段。
  - 随后构建九张汇总表（phase/category/core_group/phase_core_group/category_core_group/name/phase_tid/overlap/bubble）与 overview；自动诊断接收 overview 加其中八张表（不含 phase_tid_summary）。图表与 LLM 分析是可选支路，最终统一落到 output 目录的 CSV、report.md 与 summary/diagnosis JSON。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L164–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L164-L197),
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/parser.py:L144–L169
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/parser.py#L144-L169`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L122–L162
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py#L122-L162`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ascend-trace-analysis-pipeline.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
