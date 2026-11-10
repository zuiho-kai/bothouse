---
name: rules-release-contracts
description: "Model Executor release API 与输出所有权合同 EXEC-RELEASE-1a 至 EXEC-RELEASE-1d（PR #8459）：multimodal processor / dummy-input builder 迁移保留模型 conditioning 与每请求 cache、capture_model(profile_only=True) 与 codec dummy 输入、auxiliary Omni stage 只包装 upstream DefaultModelState、native auxiliary output 冻结 request 行并在交付后释放（含 NPU legacy capture adapter）"
metadata:
  scope: 只收随 upstream release 升级的 processor/dummy、profiling、state selection 与 auxiliary output 四条规则；routed-expert 回归验证 native V2 auxiliary output 的 EXEC-7e 归 rules-output-contract，MRv2 FULL graph aux tree 归 rules-mrv2-output-contracts，warmup 请求识别归 rules-warmup-ids
---
# Model Executor release API 与输出所有权合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-release-contracts.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8459；vllm_omni/inputs/mm_processor.py；vllm_omni/inputs/preprocess.py；vllm_omni/worker_v2/omni_model_runner.py；vllm_omni/platforms/npu/worker/aux_output.py
- 置信度（confidence）：high
- [EXEC-RELEASE-1a] dummy budget 与 processor API 迁移必须保留模型 conditioning
  - 触发：升级 multimodal processor、dummy-input builder、cache 或 renderer truncation API。
  - 强制：Omni builder 的自定义 `get_dummy_processor_inputs` 仍到达模型 consumer，保留 reference `prompt_text/ref_text` 等 kwargs；标准 builder 走 upstream fallback。已移除 `_get_hf_mm_data` 时从实际 item 提取 processor/passthrough data，保持 Omni custom processor 所需的 raw key（如 `audios`），不无意套 upstream 的 renamed `audio`/dummy-text。
  - 强制：cache 从当前 `ProcessorInputs.cache` 取得；multimodal result/prompt updates 使用目标 release 的结果合同。sync/async singleton path 都传 `tok_params`，对展开后的 prompt 执行 upstream truncation，不能切断 media placeholder；no-media kwargs 仍到达处理器。
  - 验收：真实 CosyVoice3/GLM-TTS/OmniVoice/MiMo builder 路径和标准 builder control；raw processor keys、passthrough、空 modality、audio-in-video 成对 cache 与 prompt updates；sync/async、有无 media 的 truncation 保留完整媒体边界。mock 结果不证明真实模型质量。^[PR #8459]
- [EXEC-RELEASE-1b] profiling pool、capture 与 dummy codec 输入必须分别遵守 release 合同
  - 触发：升级 runner 的 `profile_only`、`randomize_inputs`、dummy input 或 attention metadata API。
  - 强制：`capture_model(profile_only=True)` 透传 upstream profiling flag，但不留下 model-owned MTP graphs；仅真实 capture 阶段录制它们，临时 forward/aux flag 在异常和正常退出都恢复。dummy `is_padding=not is_profile`、active LoRA 数及 model-specific attention metadata 传到当前 upstream owner。语言模型可按 flag 随机输入，codec dummy 保留模型词表内有效 token。
  - 验收：profile/real capture、tensor/tuple output、正常/异常恢复与 MTP capture 次数；AR/generation dummy paths 分别验证 randomize、padding flag、合法 codec IDs、upstream execution state 与 attention metadata 透传。GPU replay 和资源结论需另外真实验证。^[PR #8459]
- [EXEC-RELEASE-1c] auxiliary Omni stage 只能包装 upstream 默认 model state
  - 触发：stage MRv2 selection、input validator 或没有模型自有 lifecycle hook 的 auxiliary stage。
  - 强制：模型自有 factory/capability 先决定 Omni state；否则调用 upstream factory，只有 exact `DefaultModelState` 且属于 `OmniModelConfig` stage 时补 Omni lifecycle。专用 upstream state 与 plain vLLM config 原样保留。input/logits validator 使用本 stage 的实际 `use_v2_model_runner`，不能让 process-wide preference 覆盖部署选择。
  - 验收：auxiliary default、specialized upstream、plain vLLM 和 model-owned factory 四路，再将全局 preference 与 stage flag 故意设为相反，验证选择与实际 runner 一致。^[PR #8459]
- [EXEC-RELEASE-1d] native auxiliary output 必须冻结 request 行并在交付后释放
  - 触发：升级 routed-expert/aux-output connector、async output 或 NPU legacy worker。
  - 强制：scheduler 打包 connector metadata，worker `begin_step` 包括无 forward 的控制步；prepare output 先冻结 request IDs、query-start 与 computed-token frontier，CPU copy 完成后才 materialize。AR 携带实际 sampled/rejected counts，generation 无 sampled tokens 时用零 counts；仅有 pending auxiliary output 时也必须进入支持它的交付路径。
  - 强制：NPU legacy capture 获取 remap/shared-expert expansion 前的 logical expert IDs，每个 router 只包装一次；排除 partial-prefill 的 sampled count 和 speculative rejection 未接受的 routing suffix。关闭/重建 connector 清理 capture hooks；disabled capture 保留普通 async 路径。
    - CUDA/ROCm auxiliary output 要求支持的 V2 stage，NPU 使用专门 legacy adapter。
  - 验收：request snapshot 改写、partial prefill、speculative rejection、generation 零 counts、auxiliary-only async 交付、no-forward teardown、重复初始化与 disabled control；NPU 实机与跨设备 parity 独立验收。^[PR #8459]

## 决策与踩坑

- [EXEC-RELEASE-1a] 禁止：只修 import/signature 而丢模型 dummy conditioning；全局 processor cache 代替每请求 cache；绕过标准 fallback 或通过粗截 token 消除 expanded prompt 超长。
- [EXEC-RELEASE-1b] 禁止：把临时 profiling pool 中的 capture 当成生产 replay graph；用语言模型随机词表填 codec IDs；generation profiling 为测 KV 而执行 Code2Wav 并把 transient workspace 算入预算。
- [EXEC-RELEASE-1c] 禁止：把所有非 Omni architecture 都无条件包装；因 shared auxiliary stage 没有模型 hook 而丢 request/output lifecycle；用全局 V2 env 改变 legacy stage 的 CFG 参数验证器。
- [EXEC-RELEASE-1d] 禁止：继续读旧 `routed_experts` 字段绕开 native connector；让下一 batch 改写未交付的行映射；无 forward 时跳过 terminal/hash metadata；把 NPU CPU contract 测试说成 NPU hardware 已验证，或把旧 CUDA legacy stage 的 unsupported 配置静默放行。
