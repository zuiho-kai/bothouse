---
name: rules-duplexeval-judge
description: vllm-omni Omni-DuplexEval 判分校验规则：VLLM-OMNI-PR9390-DUPLEXEVAL-JUDGE-SCORES（judge 回复须 finish_reason=stop、按任务分数校验、.judge.jsonl 轨迹与 .previous 重试归档、frame-sample 回退）与 VLLM-OMNI-PR9056-JUDGE-GT-REFS（content 提示词 GT 参考去空白去重）
metadata:
  scope: "只收 PR #9390 与 PR #9056 两条判分校验规则；`vllm bench serve` 接线与 run 目录归 vllm-omni-rules-2 的 PR8645 规则，夜间守卫调用方式归 vllm-omni-rules-3 的 PR8871 规则"
---
# vllm-omni Omni-DuplexEval 判分校验规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/rules-duplexeval-judge.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #9390；PR #9056
- [VLLM-OMNI-PR9390-DUPLEXEVAL-JUDGE-SCORES] Omni-DuplexEval 判分门槛：finish_reason=stop、按任务分数校验、原始回复轨迹与重试归档，judge 失败先走既有回退
  - 触发：改动 `vllm_omni/benchmarks/duplex/` 判分链路——`omni_duplex_eval_metrics.py`（`parse_judge_json`）、`omni_duplex_eval_judge.py`（`DuplexJudge`、`JudgeResponseError`）、
    - `omni_duplex_eval_eval.py`（`evaluate_sample`、`summarize_scores` 及 content 判分失败后的回退）——或其测试 `tests/benchmarks/duplex/test_omni_duplex_eval_judge.py`、`tests/benchmarks/duplex/test_omni_duplex_eval_serving.py`、`tests/e2e/features/fullduplex/test_omni_duplex_eval_cli.py`，
    - 或 `docs/cli/bench/serve.md` 中 judge 回复要求与重试工件小节。`vllm bench serve` 接线与运行目录语义见 VLLM-OMNI-PR8645-DUPLEXEVAL-BENCH，夜间守卫调用方式见 VLLM-OMNI-PR8871-DUPLEXEVAL-CI；本规则只覆盖判分校验本身，不改变那两条规则的门槛。
  - 强制：judge 回复必须显式以 `finish_reason="stop"` 结束才可评分：`finish_reason` 缺失或为 null 时即使分数 JSON 可解析也判失败（能解析出分数不是生成完成的证据），`length`、`content_filter`、`tool_calls`、`function_call` 及未知值同样被 `DuplexJudge` 以 `JudgeResponseError` 拒绝。
    - 分数校验按任务进行：temporal 判分需 `temporal_score`（0–3 整数）与 `is_relevant`（0 或 1），content 判分需 `content_score`（0–3 有限数值），PR 判分需 `success_score`（0 或 1）；越界、NaN/Infinity（含其字符串形式）、布尔、null、类型不符（如整数字段给小数）或缺失字段一律被 `parse_judge_json` 拒绝，而完成回复中的合法 0 分仍计为已评测样本，受支持的数字字符串（"1"、"2.0"、"
    - 2.50"）及 ```json 围栏、噪声前缀文本中的可解析分数继续接受并归一化为数值。拒绝后的走向按判分链路而定，不得一概判死样本：`omni_duplex_eval_eval.py` 在 content 判分的 `judge_result(...)` 失败（如全视频上下文溢出）后捕获 `Exception`，存在采样帧时改用 `mode="frame-sample"` 重试，既有的分块提醒评分路径同样保留——一次 judge 调用被拒或失败不必然使样本失败，样本只有当判分链路（含回退）无法给出有效结果时才判失败；PR 判分被拒时 `evaluate_sample`
      抛错且该样本不写分数文件。每次 judge 调用的原始回复写入分数旁的 `<sample>.judge.jsonl`；`finish_reason` 仅在捕获 `JudgeResponseError`（回复不完整或完成状态缺失/非 stop 被拒）时随该轨迹条目落盘，成功的 judge 调用不承诺写入 `finish_reason`，不得把"每次调用都记录 finish_reason"当作验收条件；被拒样本在摘要计 0 但保留 raw_response 诊断轨迹。重试评测须先把既有分数归档为
      `<sample>.json.<unique-id>.previous`（后缀保持稳定：摘要与准确率 CI 均按 `*.json` 扫描，`.previous` 因此被排除）并重置回复轨迹；失败的重试不留活动分数，新分数仅在判分所需的 judge 调用（含 `frame-sample` 回退重试）成功后发布；无关样本不受其他样本重试影响仍计入摘要，重试成功后只计新鲜分数。serving 评测经既有 failure/coverage 字段报告无效 judge 输出，judge 失败仍不废弃已完成的性能测量。
  - 验收：`tests/benchmarks/duplex/test_omni_duplex_eval_judge.py` 以 `core_model and cpu` 标记通过，覆盖无效分数参数化拒绝、合法官方格式保留、不完整回复无分数但轨迹含 raw_response 与被拒 finish_reason、缺失或非 stop 完成状态即使分数有效也被拒、失败重试归档旧分数并从摘要排除且无关样本仍计数；`omni_duplex_eval_eval.py` 保留 content 判分失败后的 `frame-sample` 回退；
    - `docs/cli/bench/serve.md` 保留 finish_reason 与按任务分数字段要求及 `.judge.jsonl`、`.previous` 工件说明。^[PR #9390]
- [VLLM-OMNI-PR9056-JUDGE-GT-REFS] Omni-DuplexEval content 提示词的 GT 参考须先去空白、去空串并按首现去重
  - 触发：改动 `vllm_omni/benchmarks/duplex/omni_duplex_eval_eval.py` 中 `evaluate_sample` 传给 `build_content_prompt` 的参考集合或 `_gt_references` 辅助函数，或改动 `tests/benchmarks/duplex/test_omni_duplex_eval_gt_references.py` 回归测试；本规则仅覆盖 content 提示词的 GT 参考处理，temporal 与 proactive-reminder 判定路径不在范围内。
  - 强制：content 提示词调用点必须传入 `_gt_references([sample.answer1, sample.answer2])` 的结果：跳过 `None`，对每项做 `str(...).strip()`，丢弃剥离后为空的串，再以 `list(dict.fromkeys(...))` 按首次出现去重，对齐官方 OpenBMB/Omni-DuplexEval 评测器 `non_empty_strings` 加首现去重的参考语义；`build_content_prompt` 的 pin 措辞与 `PROTOCOL_PIN` 不随该过滤改动。
  - 验收：`tests/benchmarks/duplex/test_omni_duplex_eval_gt_references.py`（`core_model` + `cpu` 标记）通过：`answer2 == ""`、`answer1 == answer2`、参考带首尾空白三类参数下，捕获的 content 提示词均只含一个 `Reference annotations` 条目、无 `\n2. ` 编号槽且参考文本仅出现一次。^[PR #9056]

## 决策与踩坑

- [VLLM-OMNI-PR9390-DUPLEXEVAL-JUDGE-SCORES] 禁止：把不完整回复（非 stop 或缺失 finish_reason）解析出的分数发布为有效样本；放宽校验以接受越界、非有限、布尔或 "bad" 类字符串分数；取消 `.judge.jsonl` 原始回复落盘或被拒回复的 finish_reason 诊断保留；移除 content 判分失败后的 `mode="frame-sample"` 回退或分块提醒评分路径，令单次 judge 失败直接判死样本；令 `.previous` 归档分数重新进入摘要或准确率统计；
  - 在判分链路（含回退）整体失败时仍发布或保留活动分数。
- [VLLM-OMNI-PR9056-JUDGE-GT-REFS] 禁止：把 `[sample.answer1, sample.answer2]` 未经 `_gt_references` 直接入参（空 `answer2` 会在 `Reference annotations` 块留下空编号槽，`answer1 == answer2` 会把同一参考列两次）；删除或削弱该过滤（如只去空串不去重）；借机改动 content 提示词 pin 措辞、`PROTOCOL_PIN` 或 temporal/proactive-reminder 路径。
