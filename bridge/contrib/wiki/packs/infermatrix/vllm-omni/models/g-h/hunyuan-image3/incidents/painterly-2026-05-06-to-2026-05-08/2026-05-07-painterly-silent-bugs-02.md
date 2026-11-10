---
name: 2026-05-07-painterly-silent-bugs-02
description: "2026-05-07 HunyuanImage3 AR 带图 greedy 输出每次不一致：hunyuan_image3.py:1719 的 latent_dist.sample() 没传 generator 走全局 RNG（HF 对应 modeling_hunyuan_image_3.py:2437 传 generator），仅 I2T/IT2I 触发；另有 hunyuan_image3_moe.yaml 的 engine_output_type: latent 与 is_comprehension: true 冲突的二级 bug"
metadata:
  scope: 只收 VAE encode 漏传 generator 造成 greedy 漂移与 yaml engine_output_type 冲突；user_prompt key 静默 fallback 归 2026-05-06-painterly-silent-bugs-01
---
# 2026-05-07 — HunyuanImage3 AR 带图 greedy 输出每次跑不一致

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-07-painterly-silent-bugs-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-07-painterly-silent-bugs-02`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：HunyuanImage3 AR 带图 greedy 输出每次跑不一致
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：同事反馈 vllm-omni HunyuanImage3 AR 在 greedy（temperature=0）下输出 token 序列不稳定，多次跑同一 prompt+图片得到不同结果；HF 官方实现同条件下稳定可复现。
- **根因**：`vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py:1719` 调用 `vae_encode_result.latent_dist.sample()` 没传 `generator` 参数；`autoencoder_kl_3d.py:46-54` 的 `DiagonalGaussianDistribution.sample()` 在 `generator=None` 时走全局 RNG（`x = mean + std * randn_tensor(generator=None)`）。
  - 每次 prefill VAE latent 都重新抽样 → 图像 token embedding 漂 → 进 transformer 后 logits 微动 → greedy argmax 在边界 token 翻位。
  - HF 对应位置在 `modeling_hunyuan_image_3.py:2437` 是 `latent_dist.sample(generator)`，generator 由 `prepare_seed`（line 2362）+ `torch.Generator(device).manual_seed(seed)`（line 2775-2776）构造，所以给定 seed 时确定。**只在带图 AR（I2T/IT2I）路径触发；纯 T2T 不走 vae_encode 不受影响。**
- **附带的二级 bug**：`vllm_omni/model_executor/stage_configs/hunyuan_image3_moe.yaml:28` 写 `engine_output_type: latent`，但同 yaml line 41 `is_comprehension: true` + line 43 `final_output_type: text`。
  - 模型代码 `hunyuan_image3.py:1515-1516` 只看 `engine_output_type` 决定 `_is_comprehension`，所以 `engine_output_type=latent` → `_is_comprehension=False` → 走 generation 分支启用 stage_transitions / ratio restriction，跟 yaml 表达的"comprehension/text"意图相反。`hunyuan_image3_t2i_2gpu.yaml` 同款冲突。
  - 这条不直接造成 greedy 漂，但会让 sampler 上错误的 logits processor，跟 HF think-mode 行为对不齐。
- **解法**：
  1. `_vae_encode` 接受 request seed，内部构造 `torch.Generator(device).manual_seed(seed)` 传给 `latent_dist.sample(generator)`。或者用 `DiagonalGaussianDistribution(deterministic=True)` 取 mean 作 latent（需先验证画质影响）
  2. `hunyuan_image3_moe.yaml` / `hunyuan_image3_t2i_2gpu.yaml` 的 `engine_output_type` 改回 `text`，或确认这个 stage 是否真的应该走 generation 分支
- **对未来的提醒**：
  - "对齐 HF" / "greedy 不一致" 类问题第一步是 `grep -E "randn|\.sample\(|torch\.Generator|manual_seed|dropout"` 全量审计显式随机源，不要直奔 MoE/attention 嫌疑链——具体方法见 [[alignment-debug]]（alignment debug） §1
  - 让用户复现时记录"第一个分歧 token 之前的 prefix 长度"。分歧出现在图像 token 紧后第一个文本 token = VAE/multimodal embedding；分歧在几十 token 之后才出现 = TP allreduce 顺序 / bf16 atomic 这类二阶因素
  - yaml 里 `engine_output_type` / `is_comprehension` / `final_output_type` 三个字段一旦冲突，优先信代码里实际读哪个——这里只读 `engine_output_type`，剩下两个是给 pipeline_registry 用的元数据，不进模型分支判断
