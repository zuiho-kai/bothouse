---
name: feature-depth-ascend-trace-analysis-pipeline
description: ascend-moe-optimizer-trace-analyzer 实现深读：main() 校验输入→解析 trace→构建 PhaseMapper 的流程、run_llm_command(prompt, command, timeout_s=120) 契约、--llm-analysis 默认关闭与 --llm-command/--llm-timeout 默认值、仅 shlex/空命令/FileNotFoundError/TimeoutExpired/非零退出被捕获的错误契约、instances_df 作为所有汇总表单一数据源的影响、check=False 取舍、SKILL.md 记载的基础验证命令（未执行）
metadata:
  scope: 只收实现深读（main 流程、run_llm_command 契约与错误分支、instances_df 影响、取舍、未执行的手动验收记录）；功能概览归 feature-ascend-trace-analysis-pipeline-1、feature-ascend-trace-analysis-pipeline-2
---
# ascend-moe-optimizer-trace-analyzer CLI 主流程：实现深读

## 现状

- [[feature-ascend-trace-analysis-pipeline-1]]、[[feature-ascend-trace-analysis-pipeline-2]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main() 在校验输入后依次解析 trace 并构建 PhaseMapper** main() 先 parse_args()，再 validate_inputs()（文件不存在时抛 FileNotFoundError），ensure_dir(args.output_dir) 后调用 parse_trace_json/events_to_dicts 解析事件，最后用 PhaseMapper(args.phase_map) 构建 phase 映射；后续摘要构建与诊断表内容不在已展示行内，不展开。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L158–L170](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L158-L170),
  - [jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L94–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L94-L99)
- **run_llm_command(prompt, command, timeout_s=120) 契约：stdin 送 prompt，返回 status/analysis/error 字典** 调用方传入 prompt 字符串与 shell 命令字符串；命令经 shlex.split 后以 subprocess.run 执行，prompt 写入 stdin，capture_output 收集输出，check=False；
  - 成功时返回 {"status":"ok","analysis":stdout.strip(),"error":""}，失败路径返回错误 status 与 error 文本。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L171–L221
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py#L171-L221`）
- **LLM analysis is opt-in: --llm-analysis flag off by default, --llm-command default None, --llm-timeout default 120** argparse defines --llm-analysis with action="store_true" (absent by default),
  - --llm-command with default=None whose help says the command can alternatively come from TRACE_ANALYSIS_LLM_CMD, and --llm-timeout type=int default=120 described as the timeout in seconds for the --llm-analysis command.
  - The shown span does not include the code that resolves --llm-command against the environment variable, so precedence is not established here.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L71–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L71-L90)
- **main() derives all summary tables from the single instances_df built by build_phase_instances** app.py imports parser, PhaseMapper, eleven metrics builders, diagnosis and llm_analysis helpers, and reporter functions from the sibling analyzers modules; inside main(),
  - phase/category/core-group/name/tid/overlap/bubble/overview outputs are all computed from instances_df, so a change in build_phase_instances' row shape propagates to every downstream table and to build_auto_diagnosis's inputs.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L8–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L8-L34),
  - [jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L171–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py#L171-L197)
- **run_llm_command converts only shlex, empty-command, FileNotFoundError, TimeoutExpired and nonzero exit into status dicts** shlex.split raising ValueError returns {status: "error", error: f"Invalid LLM command: {exc}"}; an empty argv returns {status: "not_configured",
  - error: "Empty LLM command."}; subprocess.run's FileNotFoundError and TimeoutExpired (after timeout_s, default 120) return status "error"/"timeout" respectively; a nonzero returncode returns stderr or a code message.
  - Only these branches are guarded; other exceptions from subprocess.run would propagate uncaught.
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L171–L221
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py#L171-L221`）
- **run_llm_command 以 check=False 加状态字典返回，非零退出不抛异常但丢弃其 stdout** 设计推断（非作者历史意图）：
- run_llm_command 用 subprocess.run(check=False) 运行外部 LLM 命令：收益是非零退出不抛异常而是返回 {"status":"error", "error": stderr 或退出码信息}；代价是失败分支不返回 result.stdout，超时/找不到可执行文件分支同样 analysis 为空字符串。
- 来源：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L188–L221
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py#L188-L221`）
- **SKILL.md 记录的基础验证命令（documented_manual，未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md「依赖和验证」节给出基础验证步骤：cd 到 skill 根目录后运行 python3 app.py --trace <TRACE_JSON> --phase-map <PHASE_MAP> --output-dir <OUTPUT_DIR> --top-n 20，预期是完成一次分析运行。该文档还声明默认运行只用 Python 标准库。这是已记录的手工过程，本次未执行；未提供针对 app.py 的自动化测试证据。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/SKILL.md:L157–L217](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/SKILL.md#L157-L217)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-ascend-trace-analysis-pipeline.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L171-L221
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L71-L90
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L8-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L171-L197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L158-L170
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py:L94-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py:L188-L221
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/SKILL.md:L157-L217
- 源页字段（feature）：ascend-trace-analysis-pipeline
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/app.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/phase_mapper.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/diagnosis.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/llm_analysis.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/metrics.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/parser.py
  - jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/plots.py；jiuwenswarm/resources/agent/workspace/skills/ascend-moe-optimizer-trace-analyzer/analyzers/reporter.py
