---
name: rules-score-handoff
description: YuE2 SheetSage2 score handoff 规则 YUE2-SCORE-1a：tools/sheetsage2_transcribe.py 加载权重前的参数/remote-code 检查、ABC/MIDI 双成功才导出 YuE speech request（cot=full/melody）
metadata:
  scope: 只收 YUE2-SCORE-1a 一条规则；YuE2 在线 speech 请求合同与数值边界归 rules-interface，synthesis 与完成边界归 yue2-rules
---
# YuE2 SheetSage2 score handoff 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/yue2/rules-score-handoff.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, serving；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8371
- 置信度（confidence）：high
- [YUE2-SCORE-1a] transcription 成功与可发送 YuE request 必须是两个显式门禁
  - 触发：修改 `tools/sheetsage2_transcribe.py` 的参数、remote-code/local-snapshot loading、ABC/MIDI 输出或 YuE speech request export。
  - 强制：加载权重前检查显式 `--trust-remote-code`、已有 input audio、finite positive duration、空/新 output directory、local model directory，以及 request export 成对的非空 lyrics/style；seed 仅用于请求导出并保持合法整数范围。默认远端 model/code 使用工具声明的固定 revisions，offline/local snapshot 保留相对 Python imports 和 `local_files_only`；
    - 模型与 MERT 权重先按 FP32 合并，执行 dtype 由 transcription 路径选择。生成 YuE request 前须同时得到非空 ABC、无 ABC error 和 `MThd` MIDI bytes；完整 score 选择 `cot=full`，melody-only 选择 `cot=melody`，保留 lyrics、style、model 和可选 seed。
  - 验收：无效参数和不可信 remote code 在模型加载前失败；local snapshot 含 transitive relative imports 的 offline case 可运行；ABC/MIDI 失败返回非零且不写 request，成功 export 的 cot 与 score 模式、lyrics/style/seed 一致。^[PR #8371]

## 决策与踩坑

- [YUE2-SCORE-1a] 禁止：未完成参数检查就加载大模型；local offline 模式补下载依赖或改写 upstream snapshot；在 ABC/MIDI 任一失败时仍产出可发送 request；将 transcription helper 当成 online YuE 自带音频转谱能力。
