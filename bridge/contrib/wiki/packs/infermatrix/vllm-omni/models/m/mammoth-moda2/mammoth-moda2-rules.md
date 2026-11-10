---
name: mammoth-moda2-rules
description: "MammothModa2 规则 MAMMO-1a 至 1d：AR sampling 按 task 隔离 text 与 visual vocabulary（PR #6694）、AR→DiT bridge 的 token/hidden-state 对齐与尺寸优先级、full_hidden_states 保持源 FP16/BF16（PR #7102）、T2I 尺寸须为 16 的倍数并在 AR grid 前拒绝（PR #7482）"
metadata:
  scope: 只收 MAMMO-1a/1b/1c/1d；step runtime 归 rules-step-runtime，TeaCache 与 QK RoPE 归 rules-cache-kernels，image serving 归 rules-image-serving，名称与拓扑归 mammoth-moda2-overview
---
# MammothModa2 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/mammoth-moda2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor, diffusion；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：PR #6694；vllm_omni/model_extras/mammothmodal2_preview.py；vllm_omni/model_executor/models/mammoth_moda2/mammoth_moda2.py；vllm_omni/model_executor/stage_input_processors/mammoth_moda2.py；vllm_omni/diffusion/models/mammoth_moda2/pipeline_mammothmoda2_dit.py
  - tests/model_extras/test_model_extras.py；tests/e2e/offline_inference/test_mammoth_moda2_expansion.py；PR #7102；PR #7482
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| task-scoped AR vocabulary | `MAMMO-1a` |
| AR→DiT token/hidden-state bridge | `MAMMO-1b` |

### [MAMMO-1a] AR sampling 必须按 task 隔离 text 与 visual vocabulary

- 触发：修改 Preview/Qwen2.5-VL 或 Dev/Qwen3-VL 的 T2I prompt、额外 generation vocabulary、EOL 约束、`generated_len` runtime metadata 或 `omni_task` routing。
- 强制：T2I prompt 以 16-pixel patch 将输出尺寸映射为 AR grid，并携带 image-grid、EOL 与 visual-token range；runner 必须为每个 request 注入实际 `generated_len`。T2I 的每行普通位置只允许 visual-token range 且排除 EOL，在 `generated_len % (ar_width + 1) == ar_width` 时只允许 EOL；chat/understanding task 必须屏蔽完整 extra generation vocabulary。
  - Qwen2.5 与 Qwen3 consumer 均维持这一分支，不能用 checkpoint 名或 pipeline 名代替 request task。
- 验收：Preview/Dev config 的 base+visual vocab 边界可构造；T2I 覆盖行内 visual range 与行尾 EOL-only，text control 覆盖 extra-vocab 全屏蔽；prompt builder 固定 task/grid/token metadata，且 negative prompt 不被注入。^[PR #6694]

### [MAMMO-1b] AR→DiT bridge 必须保留 token/hidden-state 对齐

- 触发：修改 `mammoth_moda2` 两阶段 pipeline、`ar2dit`、AR multimodal output 或 DiT condition split。
- 强制：stage 0 必须输出 `multimodal_output.latent`；bridge 将 prompt token ids 与 generation 的 cumulative ids 拼接，但删除最后一个没有对应 hidden state 的 generated token，并断言 token 总数与 hidden-state 第一维一致。跨 stage 传输前 hidden state 转为 contiguous FP32，以避开 numpy/BF16 serializer 边界；
  - 同时传递 answer boundary、目标尺寸和 DiT sampling extras。DiT 从自己的 model config 取得 generation-vocab 与 vision-placeholder ids，按 question/answer boundary 分离 text/image conditions，并在没有生成 visual-token hidden state 时显式失败。
- 尺寸优先级固定为 serving 写入的 `mm_processor_kwargs.target_h/target_w`、原 prompt `additional_information`、最后才是 1024 default。`text_guidance_scale`、`cfg_range` 和 `num_inference_steps` 通过 `extra_body → sampling.extra_args` 进入 DiT；legacy payload 仅作兼容 fallback，不能假设标准 diffusion request 自动拥有这些 kwargs。
- 验收：覆盖 single dict/list prompt normalization、缺 latent、token/hidden mismatch、尺寸优先级、empty visual condition、extra-body 参数透传和 AR-only text control。PR 作者报告的 54 个 CPU tests 与单次 L20X Preview T2I PNG smoke 只证明该提交环境的路径可运行；golden-image E2E 仍因既有 issue skip，不能据此声称质量、吞吐、Dev T2I 或跨硬件能力。^[PR #6694]

### [MAMMO-1c] AR→DiT `full_hidden_states` 必须保持源 FP16/BF16 直至 DiT 消费

- 触发：修改 `ar2dit`、`serialize_additional_information` / EngineCore payload，或 DiT `_split_ar_conditions` 的条件行选取与最终 `.to(device, dtype)`。
- 强制：跨 stage 传输保持 AR 源 dtype（FP16/BF16）的 contiguous `full_hidden_states`；EngineCore/OmniSerializer 以 raw bytes 保留 bfloat16，不得为“过 numpy 边界”无条件 `.float()` 扩成 FP32。DiT 在选完 text/image 条件行之后，才在既有最终转换点落到 model device/dtype。
- 验收：FP16/BF16 经 serialize/deserialize 往返 dtype 与数值不变；condition split 输出保持 transfer dtype 直至最终 cast；connector 级 BF16 round-trip 覆盖。^[PR #7102]

### [MAMMO-1d] T2I 尺寸必须在 AR grid 构造前拒绝非法值

- 触发：修改 MammothModa2 prompt builder 的 height/width 默认、AR grid 或 image metadata。
- 强制：每一轴仅 None 使用1024；显式值必须为正且是16的倍数，再以16-pixel patch 构造 grid。三种 registry/model class alias 共享校验；一个轴省略不能掩盖另一轴非法值。
- 验收：三个 class alias 覆盖双 None、单轴省略、16边界与普通矩形；每轴负数、0、1/15/17/513及另一轴省略的 control 都须 ValueError，合法尺寸的 prompt grid 与 metadata 同时正确。^[PR #7482]

## 决策与踩坑

- [MAMMO-1a] 禁止：让文本任务采样 image token；让 T2I 在行尾继续采样普通 visual token；用 batch-global step 代替 per-request `generated_len`；或把兼容签名中的 `negative_prompt` 当成当前 T2I prompt builder 已支持的显式 negative-conditioning 路径。
- [MAMMO-1c] 禁止：在 bridge 或 condition split 处提前 host-side float32 加倍 staging 与 H2D；把精度优化扩成 request-end streaming / Layer-2 lifecycle 设计；或假定旧 FP32 wire 注释仍有效。
- [MAMMO-1d] 禁止：用 value or 1024 把0变成默认；floor division 静默截断513等尺寸；让 prompt grid 与 metadata/request image size 不一致。
