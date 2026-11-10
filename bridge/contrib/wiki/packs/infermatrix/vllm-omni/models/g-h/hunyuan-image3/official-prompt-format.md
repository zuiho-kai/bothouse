---
name: official-prompt-format
description: HunyuanImage3 官方 prompt 格式：所有 chat 任务用 instruct 模板（system_prompt 直接跟在 <|startoftext|> 后，再接 User 段与 Assistant 段），User / Assistant 完整拼写与 trigger_tag 位置，T2T 默认产物，BPE 跨段 merge 陷阱与分段 tokenize 修法，<img> 展开中 <timestep> 的差异，修复前后的 build_prompt
metadata:
  scope: 只收 HunyuanImage3 AR prefill 的官方模板、tokenization 边界和 image token 展开差异；对 prompt / tokenizer 的可审计要求（HY3-3a…3f）归 hunyuan-image3-rules-1，HF 接入的其他偏差归 hf-alignment-pitfalls
---
# HunyuanImage3 官方 prompt 格式

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/official-prompt-format.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16

### 通用格式（2026-04-29 全任务确认）

- `generation_config.json` 默认 `sequence_template="instruct"`，所有 chat 任务的 AR prefill 必须用 instruct 模板：

```
<|startoftext|>{system_prompt}\n\nUser: {<img>?}{user_prompt}\n\nAssistant: {trigger?}
```

#### 关键事实

- **`User:` 和 `Assistant:` 完整拼写**（不是 `A:`）
  - HF tokenizer 输出 `Assistant` 是单 token 72803
  - 缩写 `A:` 是另一个 token (32) — 对话模板里不会出现
- **trigger_tag 必须在 `Assistant: ` 之后**（如 `<think>` / `<recaption>`）
  - 错放在 user_prompt 前面（`<|startoftext|>{sys}<img><think>{user}`）= **greedy 死循环**（用户文本被塞进了"思考段"）
- **system_prompt 直接跟在 `<|startoftext|>` 后**，无角色前缀
- **生成结束处 trailing newline**：`get_system_prompt("en_unified")` 返回末尾带 `\n` 的字符串。HF apply_chat_template 不 strip，让末尾的 `\n` 和 sep `\n\n` 合起来成 3 换行。手动构造时**不要 `.strip()`**。

#### T2T 专属（无 image，无 trigger_tag）

- HF baseline 默认（`prepare_model_inputs(prompt=..., mode="gen_text")` 不传 system_prompt）实际产物：

```
<|startoftext|>User: {prompt}\n\nA: 
```

- 注意 T2T 默认无 system + 用 `A:`。但 PR #3107 推荐统一 instruct + en_unified system + `Assistant:`。两者都能跑通，**有 system + Assistant: 的版本和 PR 对齐，是项目推荐**。

### Image token 展开差异（HunyuanImage3-Instruct）

- HF 实际 input_ids 里 `<img>` 被展开为：

```
<boi> + <img_size_X> + <img_ratio_X> + <timestep> + <img>×N(VAE) + <joint_img_sep> + <img>×M(ViT) + <eoi>
```

- vllm-omni `_get_prompt_updates`（`hunyuan_image3.py:1062`）展开为：

```
<boi> + <img_size_X> + <img_ratio_X> + <img>(timestep_num) + <img>×N(VAE) + <joint_img_sep> + <img>×M(ViT) + <eoi>
                                       ^^^^^^ 用 <img> 而非 <timestep>
```

- **单纯把 `<img>` 改成 `<timestep>` 会 CRASH 输出**（实测：模型开始幻觉 `image_2` 到 `image_9` 多个不存在的图）。说明 vllm-omni 在那位置还有 attention/position-id/embedding routing 的耦合。**留作 followup audit，不要单点修**。

### 修复前 vLLM-Omni build_prompt（pretrain 拼接）

```python
parts = ["<|startoftext|>"]
if sys_text: parts.append(sys_text)
if has_image_input: parts.append("<img>")
if trigger_tag: parts.append(trigger_tag)  # ❌ 在 user_prompt 之前！
parts.append(user_prompt)
```

#### 症状（修复前）

- T2T greedy: `massive arches massive arches...` 死循环
- IT2I greedy: 开头无 `<think>`，后段 `最终图像完整保留了image_1...` 重复 7 次

### 修复后（branch `feature/hunyuan-t2t-sdpa-fa`，PR 候选）

- commits: `42ee44b6` (Siglip2 list fix) → `80617a1d` (T2T instruct) → `88d16caa` (统一 instruct, trigger after Assistant) → `80e0237f` (`A:` → `Assistant:`)
- **How to apply:** 任何 HunyuanImage3 chat 任务（除了 `t2i_vanilla` 走纯 pretrain）都必须用 instruct 模板，trigger_tag 在 `Assistant: ` 之后。需要 byte-identical 对齐 HF 时走 `prompt_token_ids` 分段 tokenize 路径。

## 决策与踩坑

### BPE 跨边界 merge 陷阱

- 把 build_prompt 拼出的整串扔给 `tokenizer.encode()` BPE 时，**会跨段 merge**：

| 边界 | HF apply_chat_template | tokenizer.encode(整串) |
|------|------------------------|-------------------------|
| user_prompt 末尾 `。` + sep `\n\n` | `[1811, 271]` 两 token 分开 | `[3490]` 合并成 `。\n\n` 一个 token |
| user_prompt 末尾 `？` + sep `\n\n` | `[30, 271]` | `[1980]` 合并成 `?\n\n` |

- **根因**：HF 的 apply_chat_template 内部对 system / user_text / sep / bot_prefix 是**分段 tokenize 后拼 token_ids**，BPE 不会跨段 merge。整串 encode 走的是普通 BPE，会合并。
- **修法**（如果要 byte-identical 对齐 HF）：

```python
ids = [bos_id]
ids += tok.encode(sys_text, add_special_tokens=False)
ids += tok.encode("\n\nUser: ", add_special_tokens=False)
ids += [img_token_id]
ids += tok.encode(user_prompt, add_special_tokens=False)
ids += tok.encode("\n\nAssistant: ", add_special_tokens=False)
ids += [trigger_token_id]
# 然后传给 vllm-omni: omni.generate({"prompt_token_ids": ids, "multi_modal_data": {"image": image}})
```

- `OmniTokensPrompt` 路径 vllm-omni 已支持（`vllm_omni/inputs/data.py: token_inputs_omni()`）。

### 修复后（branch `feature/hunyuan-t2t-sdpa-fa`，PR 候选）

- **Why:** HF AR baseline 验证的是 instruct 模板。pretrain 拼接 trigger 在用户文本前会让 greedy 死循环。
