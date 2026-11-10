---
name: hf-omni-alignment-method-1
description: HunyuanImage3 HF/Omni 输出对齐的系统化排查顺序（从外向内）：先排除 attention backend，再查 prompt 格式、input_ids 逐 token 对齐、prompt_token_ids 分段路径、image embedding 与 BF16 噪声；「文本 token 一样 ≠ 输出一样」的因果注意力机制，sampling 模式下 vLLM 与 HF sampler 不可逐字对齐的对照表，max_tokens 不影响自然 stop
metadata:
  scope: 只收 HF/Omni 对齐的触发条件和五步排查顺序及两条关键认识；验证模板、实证、transformers 版本约束和用过的资源归 hf-omni-alignment-method-2，模板与 BPE 细节归 official-prompt-format
---
# HunyuanImage3 HF/Omni 系统化对齐方法（1/2）

## 关键事实

- 拆分说明：本页是源页 `hf-omni-alignment-method.md` 的第 1/2 部分；第 2 部分 [[hf-omni-alignment-method-2]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/hf-omni-alignment-method.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16

### 触发条件

- 用户反馈"vllm-omni 离线推理输出和官方 HF 不一样"
- 用户给出"omni 输出 vs official 输出"的对比，omni 缺细节 / 死循环 / 重复
- 怀疑 attention backend、prompt 格式、tokenization、image embedding 之一

### 系统化排查顺序（从外向内）

#### 1. attention backend 不是问题（先排除）

- 跑 vllm-omni FA 和 SDPA 对比（temp=0 greedy）
- 实测：HunyuanImage3 T2T 下两者输出**逐字相同**
- → 如果 FA/SDPA 一样，attention backend 排除

#### 2. prompt 格式（最常见的 bug 源）

- 跑 HF baseline 拿"对的"输出和 input_ids 作为黄金参考
  - HF: `model.prepare_model_inputs(prompt=..., image=..., mode="gen_text", bot_task="think", system_prompt=en_unified)`
  - `do_sample=False, temperature=0.0` 强制 greedy
- 跑 vllm-omni 同样的 user_prompt + image，对比输出
- 如果 vllm-omni 死循环 / 开头无结构 → **build_prompt 格式错**
- 详见 `official_prompt_format.md`

#### 3. input_ids 逐 token 对齐

- HF dump：`kw["input_ids"][0].cpu().tolist()`
- vllm-omni dump：在 build_prompt 后 `tok.encode(prompt_str)` 拿 token_ids
- 解码每个 token：`tok.decode([tid], skip_special_tokens=False)`
- 找第一个分叉位置：常见原因
  - **BPE 跨边界 merge**（如 `。\n\n → 3490` vs HF 的 `1811+271`）
  - **角色前缀拼写**（HF `Assistant:` token 72803 vs 错用 `A:` token 32）
  - **system prompt strip 问题**（末尾 `\n` 被 strip 后丢一个 token）
  - **image token 展开结构**（`<timestep>` vs `<img>` 占位）

#### 4. 终极对齐：prompt_token_ids 路径

- 当文本 BPE 边界 merge 怎么调都对不上时，**绕过 vllm-omni 的整串 BPE**：

```python
# Build segment-by-segment to mimic HF apply_chat_template
ids = [bos_id]
ids += tok.encode(sys_text, add_special_tokens=False)
ids += tok.encode("\n\nUser: ", add_special_tokens=False)
ids += [img_token_id]    # placeholder, 不展开
ids += tok.encode(user_prompt, add_special_tokens=False)
ids += tok.encode("\n\nAssistant: ", add_special_tokens=False)
ids += [trigger_token_id]

# 用 prompt_token_ids 而非 prompt 字符串
results = omni.generate({
    "prompt_token_ids": ids,
    "multi_modal_data": {"image": image},
})
```

- vllm-omni 原生支持（`OmniTokensPrompt` / `vllm_omni/inputs/data.py: token_inputs_omni()`）。

#### 5. 还对不上 → 怀疑 image embedding 或 BF16 噪声

- vllm-omni 的 image token 展开（`hunyuan_image3.py:_get_prompt_updates`）和 HF 不完全同（如 `<timestep>` 占位差异，详见 `official_prompt_format.md`）
- BF16 数值噪声：greedy 在 logits 平局时也会让 vllm-omni 和 HF 走不同路径，是无法消除的下界
- 如果只想"行为一致" 而非 byte-identical：到此可以收工

#### 关键认识：「文本 token 一样 ≠ 输出一样」

- 因果注意力的污染机制：

```
input：[text 0..1226] [image_segment 1227..6207] [user_text 6208..N] [\n\nAssistant: <think>]
                       ^^^^^^^^^^^^^^^^^^^^^^^^^
                       这段两边只要差 1 个 token（如 <timestep> vs <img>）
                       或差 1 个 BF16 ULP 的 image embedding 值，
                       后续所有位置算 attention 时都会拿到不同的 K/V
                       到 <think> 这个生成起点时，模型状态已经分叉

→ 第 1 个生成 token 就分叉，后面用 greedy 走完全不同路径
```

- 所以"文本 portion 前 1227 token byte-identical"**不足以保证输出一致**，仍要排查 image segment 的 token 结构和 embedding 数值。

#### 关键认识 2：sampling 模式下 vllm 和 HF transformers 的 sampler 不可对齐

- 哪怕 input_ids、temperature、top_p、top_k、max_tokens、seed 全设成一样，**sampling 输出也不会逐字相同**。原因：

| 项 | HF transformers | vLLM-omni |
|---|---|---|
| 采样函数所在位置 | `transformers/generation/utils.py: _sample()` | `vllm/v1/sample/sampler.py` |
| RNG 来源 | `torch.manual_seed(42)`（**全局** RNG） | `torch.Generator().manual_seed(req.seed)`（**per-request**）|
| `torch.multinomial` 用哪个 RNG | 全局——**会被 model.forward 里偷偷消耗 RNG 的 op 干扰** | 独立 generator——不被 forward 影响 |
| logits processors 顺序 | 默认 `min_length → temperature → top_p → top_k → ...` | 常 `temperature → top_k → top_p`（fused kernel）|
| top_k 实现 | logits 设 `-inf` 后 softmax | 可能 sort + truncate + renormalize |
| BF16 reduction | PyTorch 默认顺序 | Triton fused kernel 顺序 → 1e-5 量级数值差 |

- 任意一项差异都让"seed=42 抽到的下一个 token"不同。第一个 token 不同 → KV cache 分叉 → 后续 token 全部分叉 → 100 token 后输出完全不相关。
- **实测**（HunyuanImage3 IT2I sampling temp=0.6 seed=42，本会话 2026-04-29）：
  - HF：1255 字（停在 `</think>`）
  - omni（同 seed 同 yaml）：2751 字（写完 think + recaption-style + image_2 幻觉）
  - A/B 测 prompt-string vs prompt_token_ids 路径：2936 vs 2751，**两个路径量级一样**——证明长度差异**不是 BPE fix 引入的**，是 sampler 实现本质差异
- → **要 byte-identical 输出 = 不可能**（除非 vllm 调 transformers `_sample`，违背 vllm 存在意义）。→ 如果 demand 是 byte-identical：直接劝退，改对齐**功能性指标**（关键元素覆盖、结构标签命中率）。→ 单 seed 对比信号弱，要论证质量必须**多 seed 统计**或**改 greedy 缩窄变量**。

## 决策与踩坑

### 系统化排查顺序（从外向内）

#### 隐藏陷阱：max_tokens 不影响自然 stop

- omni 在 max_tokens=2048 vs 4096 下输出**完全相同**（2751 字、byte-identical），因为模型在 ~1500 token 时已经自然 hit `<|endoftext|>` 停了。max_tokens 只是上限，不强制截断。所以"对齐 max_tokens"对中长输出的 sampling 对比**没有效果**。
