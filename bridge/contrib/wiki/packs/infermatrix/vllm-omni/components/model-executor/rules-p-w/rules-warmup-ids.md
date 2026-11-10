---
name: rules-warmup-ids
description: "upstream warmup 请求识别规则 VLLM-OMNI-PR9264-MIXED-WARMUP-IDS（PR #9264）：MRv2 runner、OmniModelState 与 Fish-Omni / Higgs-Audio-v3 / Moss-TTS local 各模型 state 只能用 vllm_omni/worker_v2/warmup.py 的 is_warmup_request，覆盖 _warmup_ 与 vLLM 0.32 的 _v2_mixed_warmup_decode_ / _v2_mixed_warmup_prefill_ 前缀；单前缀判断会使 Qwen3-TTS 在 FlashInfer warmup 阶段启动失败"
metadata:
  scope: 只收 warmup request 识别集中到共享 helper 的一条规则 VLLM-OMNI-PR9264-MIXED-WARMUP-IDS；release 升级下 dummy 输入与 profiling capture 的合同归 rules-release-contracts，Dynamo 编译区 guard 归 rules-compile-guard
---
# vLLM-Omni model executor — upstream warmup request identification rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-warmup-ids.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #9264
- [VLLM-OMNI-PR9264-MIXED-WARMUP-IDS] upstream warmup 请求识别必须集中于共享 helper 并覆盖全部 ID 前缀
  - 触发：在 MRv2 runner、`OmniModelState` 或各模型 state（Fish-Omni、Higgs-Audio-v3、Moss-TTS local）中新增或修改对 upstream warmup request 的识别、text validation 豁免、preprocess/postprocess 跳过、validity 声明或 data-plane 注册逻辑。
  - 强制：识别 warmup request 只能使用 `vllm_omni/worker_v2/warmup.py` 的共享 `is_warmup_request`，它同时覆盖 legacy `_warmup_` 前缀与 vLLM 0.32 起的 `_v2_mixed_warmup_decode_`/`_v2_mixed_warmup_prefill_` 前缀；所有模型 state 与 runner 引用同一 helper。
    - 被识别的 warmup 请求走既有 warmup 处理：text 行零 codec（Fish）、保留 upstream generic text sampling/grammar/penalty 路径（Higgs）、跳过模型 preprocess/postprocess 与状态更新、仅 warmup 请求写入 fabricated validity key，且不进入 native data-plane 注册。
  - 验收：识别/validity/preprocess-skip/data-plane 测试按 `_warmup_0_`、`_v2_mixed_warmup_decode_`、`_v2_mixed_warmup_prefill_` 三种 ID 参数化，并以真实请求 ID 作反例；warmup 路径断言 `preprocess`/`postprocess` 未被调用；升级 vLLM 后跑 Qwen3-TTS 两阶段 FlashInfer 启动并验证 `/health` 返回 200。^[PR #9264]

## 决策与踩坑

- [VLLM-OMNI-PR9264-MIXED-WARMUP-IDS] 禁止：在任何模型 state 或 runner 里散落硬编码 `_warmup_` 单前缀判断——vLLM 0.32 的 mixed-attention warmup 会被当作真实 TTS 请求处理，因缺少 text conditioning 使 Qwen3-TTS 在 FlashInfer warmup 阶段启动失败；也不得只为单个模型复制前缀列表而不回迁共享 helper。
