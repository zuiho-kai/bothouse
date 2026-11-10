---
name: rules-diffusion-speech-params
description: "规则 VLLM-OMNI-PR8685-SAMPLING-VALIDATION：serving_speech.py 的 _create_diffusion_speech 在 generate() 前校验 extra_params——num_inference_steps 必须为正整数、guidance_scale 必须有限、拒绝布尔 / NaN / Infinity / 10**400，统一映射 HTTP 400 且不改 engine 默认参数（PR #8685）"
metadata:
  scope: 只收 pure-diffusion /v1/audio/speech 采样参数覆盖的请求边界校验这一条规则；pure-diffusion TTS 的 adapter 短路（SERV-5g）归 rules-engine-lifecycle-1，speech 输出采样率归 rules-speech-output
---
# Diffusion speech 采样参数校验规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-diffusion-speech-params.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-25；updated: 2026-10-25
- 来源（sources）：PR #8685
- [VLLM-OMNI-PR8685-SAMPLING-VALIDATION] diffusion speech 采样覆盖必须在请求边界做整值与有限性校验
  - 触发：修改 `vllm_omni/entrypoints/openai/serving_speech.py` 中 `_create_diffusion_speech` 对 `extra_params`（`num_inference_steps`、`guidance_scale`）的解析，或 pure-diffusion `/v1/audio/speech` 的采样参数覆盖与错误映射。
  - 强制：在调用 `generate()` 前完成全部校验，并经既有 ValueError→HTTP 400 通道返回结构化错误：`num_inference_steps` 必须是正整数，接受整数字符串与整值浮点；`guidance_scale` 必须是有限数，有限数值字符串、0 和负值合法；两参数都拒绝布尔值。类型转换的 `TypeError`、`ValueError`、`OverflowError` 均映射为对应 400 消息，不得外溢为 500。覆盖只写入 per-request sampling 对象，engine 默认参数保持不变。
  - 验收：`tests/entrypoints/openai_api/test_serving_speech.py` 参数化覆盖非法输入（0、-1、0.5、12.5、True/False、nan/±inf、"NaN"/"Infinity"、10**400），断言对应 400 消息且 mock engine 的 `generate` 未被调用；合法用例（空参数取默认、"12"/12.0 整值、guidance "7.0"/0.0/-1.0）断言 200、`sampling_params_list` 中的值精确匹配且默认对象未被改动。^[PR #8685]

## 决策与踩坑

- [VLLM-OMNI-PR8685-SAMPLING-VALIDATION] 禁止：静默截断非整值步数（12.5→12）；把布尔值当数字接受；接受 "NaN"/"Infinity" 字符串或 nan/±inf 浮点；让 `OverflowError`（如 10**400）穿过校验变成 500；在校验路径修改 `default_sampling_params_list` 中的默认对象。
