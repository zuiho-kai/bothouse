---
name: feature-ascend-trace-analysis-pipeline-1
description: ascend-moe-optimizer-trace-analyzer app.py 概览第 1 部分：Ascend 1C2V 核组归因（cube/vector_recv/vector_send）与重叠/空洞分析、CLI 入口 main() 与参数、错误契约
metadata:
  scope: 只收该功能概览的前半（核组归因、重叠与空洞分析、CLI 入口与参数/错误契约）；入口存在性检查、日志、phase map 加载与九张汇总表主流程见 feature-ascend-trace-analysis-pipeline-2；实现深读归 feature-depth-ascend-trace-analysis-pipeline
---
# ascend-moe-optimizer-trace-analyzer CLI 主流程（1/2）

## 现状

- 拆分说明：本页是源页 `feature-ascend-trace-analysis-pipeline.md` 的第 1/2 部分；第 2 部分 [[feature-ascend-trace-analysis-pipeline-2]]
- **核组归因、重叠与空洞分析**
- 除 phase/category/name/tid 等常规汇总外，组件针对 Ascend 1C2V 场景做了核组归因：从 tid 形如 `typeN_coreN` 中提取 core_type，映射到 `cube`、`vector_recv`、`vector_send` 三个核组，并输出按核组切分的 phase/category 汇总。
  - `build_overlap_summary` 计算所有 phase 两两的区间重叠（含 overlap_ratio_min 等多口径），`build_bubble_summary` 针对 processing/dispatch_gmm1/gmm2_combine 三个父 phase 计算子阶段未覆盖的空洞（bubble）。自动诊断据此产出阈值化 findings（如 wait 占比、dispatch_gmm1 与 gmm2_combine 的流水覆盖强弱）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L12–L25
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py#L12-L25`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L460–L505
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py#L460-L505`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L526–L560
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py#L526-L560`）,
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/diagnosis.py:L184–L209
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/diagnosis.py#L184-L209`）
- **CLI 入口、参数与错误契约**
- 公共入口是 `app.py` 的 `main()`（`__main__` 下以 INFO 级别初始化 logging 后调用）。CLI 由 argparse 定义：必填 `--trace`，可选 `--phase-map`（默认 `config/phase_map.yaml`）、`--output-dir`（默认 `output`）、`--top-n`（默认 20）、`--llm-analysis`、`--llm-command`、`--llm-timeout`（默认 120 秒）。
  - 运行前 `validate_inputs` 对 trace 与 phase map 做存在性检查，缺失时抛 `FileNotFoundError`。LLM 分析是可选支路：`--llm-analysis` 开启后命令经 `shlex` 解析并作为子进程执行，`run_llm_command` 显式捕获 shlex `ValueError`、`FileNotFoundError` 与 `subprocess.TimeoutExpired`，分别返回 error/timeout 状态字典；
  - 主流程仅在 `--llm-analysis` 开启且 status 非 ok 时记录 warning，未开启则返回 disabled 状态。子进程其他异常类型不在所示捕获范围内。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L50–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L50-L99),
  - [jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L303–L324](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L303-L324),
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L171–L221
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py#L171-L221`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-ascend-trace-analysis-pipeline.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L12-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L460-L505
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L526-L560
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/diagnosis.py:L184-L209
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L50-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L303-L324
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L171-L221
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L94-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L172-L182
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L365-L365
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L50-L91
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L171-L185
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L224-L250
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/phase_mapper.py:L70-L87
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L164-L197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/parser.py:L144-L169
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py:L122-L162
- 源页字段（feature）：ascend-trace-analysis-pipeline
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/phase_mapper.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/diagnosis.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/parser.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/plots.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/reporter.py
