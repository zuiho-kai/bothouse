---
name: alignment-inventory-2
description: "HunyuanImage3 AR 对齐 PR #3243 交付清单下半：HF AR baseline 测试模板（复刻 generate_image 的 stage_transitions 与 final_stop_tokens）、HF 与 omni 关键源码行号、未对齐的功能（sampling、完整 IT2I 到 DiT、T2I）、关键 commit 反向索引与 review 答辩要点"
metadata:
  scope: 只收 baseline 测试模板、源码位置、未对齐功能和 commit 反向索引；交付 commit、对照表与对齐数据归 alignment-inventory-1，baseline 误用的踩坑归 hf-alignment-pitfalls，sampler 不可对齐论述归 hf-omni-alignment-method-1、hf-omni-alignment-method-2
---
## 关键事实

- 拆分说明：本页是源页 `alignment-inventory.md` 的第 2/2 部分；第 1 部分 [[alignment-inventory-1]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/alignment-inventory.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### HF AR baseline 测试模板（避免下次又翻车）

```python
# === MUST: replicate HF official `generate_image()` AR portion ===
sys_text = get_system_prompt("en_unified", "think_recaption", None)  # 同 bot_task
model_inputs = model.prepare_model_inputs(
    prompt=USER_PROMPT, image=image, system_prompt=sys_text,
    mode="gen_text", bot_task="think",  # ← first_bot_task!
)
model_inputs.pop("max_new_tokens", None)   # ← 必 pop, generation_config 已经塞了
model_inputs.pop("eos_token_id", None)     # ← 必 pop, 同上

tkw = model._tokenizer
stage_transitions = [(tkw.end_of_think_token_id, [tkw.convert_tokens_to_ids(tkw.recaption_token)])]
final_stop_tokens = [tkw.end_of_recaption_token_id]

outputs = model.generate(
    **model_inputs, mode="gen_text", decode_text=True,
    do_sample=False, temperature=0.0,
    max_new_tokens=2048,
    stage_transitions=stage_transitions,    # ← omni 同款 _StageTransitionLogitsProcessor
    final_stop_tokens=final_stop_tokens,    # ← 在 </recaption> 停, 不进 image gen
)
```

- **禁止替换成** `model.generate(bot_task="auto", eos_token_id=[...])`——绕过 stage_transitions 拿到的不是官方推荐跑法的 baseline。详见 `feedback_check_official_demo_first.md`。

### 关键源码位置

- HF `generate_image()` 内部 stage_transitions 拼装：`hunyuan3.0_ins/modeling_hunyuan_image_3.py:3237-3320`
- HF `HunyuanTopKGate.__init__` (fp32 wg)：`hunyuan3.0_ins/modeling_hunyuan_image_3.py:1102`
- HF `HunyuanMoE.forward` (autocast disabled around router)：`hunyuan3.0_ins/modeling_hunyuan_image_3.py:1204`
- HF `HunyuanTopKGate.easy_topk` (fp32 softmax+topk+clamp)：`hunyuan3.0_ins/modeling_hunyuan_image_3.py:1132`
- omni `HunyuanImage3SparseMoeBlock`（fp32 router subclass）：`vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py:1156-1278`
- omni `_patch_moe_blocks()`（post-init module replacement + 前置 cleanup）：`vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py:1553-1620`
- omni `_StageTransitionLogitsProcessor`（is_comprehension=false 时启用）：同上文件 1530-1546 + 1900-1970
- omni `embed_multimodal()`（拼接 `[timestep, vae, vit]`）：同上文件 1789-1853
- omni `_vae_encode()`（fp32 cast at encoder boundary）：同上文件 1419-1430

### 未对齐的功能（intentional / out-of-scope）

- **sampling 模式输出**：vllm sampler ≠ transformers sampler（已知不可对齐，hf_omni_alignment_method.md 详述）。本 PR sampling 测试只验证"功能性正确"（无 garbage / 无死循环），不期望 byte-identical。
- **完整 IT2I → DiT 出图**：本 PR 只动 AR 段。DiT 段对齐工作未启动（sampling-mode 输出图像对比是另一个 PR 的范围）。
- **T2I (从纯文本生成图)**：路径走 `it2i.yaml` 的 image gen 部分，本 PR 不验证 T2I AR 输出。

### 关键 commit 反向索引

- 如果 review 问"X 改在哪里"：
  - 死循环 garbage 修复 → `27083f9c` (instruct chat template) + `ea809348` (Assistant: prefix)
  - BPE 跨段 merge → `7bd429ed` (build_prompt_tokens)
  - pixel quant noise → `41d29432`
  - top-k expert flip → `31c2fa56` (fp32 MoE router)
  - AR-only output 无尽 recap → `07d8cf0d` (stop at `</think>`)
- 如果 review 问"为什么 it2i.yaml 没改" → 因为 IT2I 完整 pipeline 要 AR 走完 image tokens 喂 DiT，不能在 `</think>` 停（commit `07d8cf0d` 的 message 详细解释）。
- 如果 review 问"BF16 还差 +16/+34 chars 怎么办" → 看 hf_omni_alignment_method.md「关键认识 2: sampler 不可对齐」+ 本文件「不可修架构差异」5 项。
