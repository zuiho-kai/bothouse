---
name: systematic-vs-stochastic
description: "同模型同 seed 下“路径 A 总是 X、路径 B 总是 Y”的分类规则 5 条：先分 systematic / stochastic、模型输入是文本 token / 多模态数据 / 采样参数三根支柱、PIL Image mode（RGBA 合成到黑底 vs 白底）是静默 bug 源、用户说 still wrong 时不接受 good enough、“一直 / consistently”不是随机；PR #3444 教训（2026-05-12，input_1_0.png 57671 个透明像素，_load_input_images 归一 RGB）"
metadata:
  scope: "只收跨路径系统性偏差与路径内随机漂移的区分方法和 PR #3444 RGBA 案例；路径内同 seed 漂移的审计归 seed-determinism-audit"
---
# Rule 1: Systematic ≠ stochastic. Classify first.

## 关键事实

- 源页：`knowledge/repos/vllm-omni/debug/guides/systematic-vs-stochastic.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-10
- When user reports "path A consistently produces X, path B consistently produces Y" on the same model with the same seed:

### Rule 1: Systematic ≠ stochastic. Classify first.

| Signal | Class | First-line investigation |
|---|---|---|
| "X every time on A, Y every time on B" (cross-path bias) | **Systematic** | Diff inputs to the model byte-by-byte. The two paths must be feeding different inputs. |
| "X then Y then Z on same path same seed" (within-path drift) | **Stochastic** | CUDA non-determinism / MoE BF16 / scheduler timing. Different fix class (deterministic mode, etc.). |
| Both | Both | Treat as systematic FIRST. Stochastic on top is a separate concern. |

### Rule 2: Model input is 3 pillars, not 1.

- For an autoregressive multimodal model (HunyuanImage-3.0 AR), the model receives:
  1. **Text token IDs** (`prompt_token_ids` or BPE-encoded `prompt` string)
  2. **Multimodal data** (PIL images → preprocessor → tensors)
  3. **Sampling params** (seed, temperature, top_k, max_tokens, stop_tokens, ...)
- Aligning pillar 1 byte-for-byte across paths (which I did via P0 prompt_token_ids fix) does **NOT** mean the model sees identical input. Pillar 2 and 3 must also be byte-equivalent.
  - In the RGBA case I missed, pillar 1 was byte-identical between online and offline but pillar 2 differed (RGBA composited over white online vs over black offline) → AR saw two different image tensors → different cot → different output.
- **How to apply:**

```
For each AR input pillar, dump from both paths and diff:
  - prompt_token_ids   (or prompt string, post-tokenize)
  - multi_modal_data["image"] -> processor -> tensor (compare image_tensor.numpy() byte-wise)
  - sampling_params (compare repr())
```

- If pillar 1 matches but pillar 2 diverges, the upstream-of-model preprocessing is the bug.

### Rule 3: PIL Image mode is a silent bug source.

- `Image.open(rgba_png)` returns mode RGBA. Different downstream consumers handle the alpha channel differently:
  - `.convert("RGB")` composites transparent pixels over **black** (the offline path uses this)
  - Some processors composite over **white** (Hunyuan AR's vae_processor does this)
  - Some processors pass RGBA through and the model sees 4-channel input
- A logo PNG with 57k transparent pixels can produce two completely different RGB tensors depending on which alpha-compositing convention the path uses.
  - This is enough to make AR recaption diverge ("1 magnet on black bg" vs "3 magnets on white bg"), which is the exact failure mode of PR #3444 online vs offline.
- **How to apply:** When two paths consume `multi_modal_data["image"]`, check the PIL mode of the input AND look at how each processor handles alpha. If you spot `.convert("RGB")` on one side and an alpha-composite on the other, that's the bug.

### Rule 4: Don't accept "good enough" when user says "still wrong".

- If you apply a fix and the symptom partially improves but doesn't fully go away, **keep digging**. Don't escalate to "this is inherent" until you've enumerated every layer.
- My specific failure mode: I had P0 (prompt_token_ids) + P1 (task/bot_task/sys_type split) + KV-reuse fix. Each was a real improvement, but the "online consistently 3 magnets" complaint persisted.
  - Instead of asking "what AR input dimension am I still missing?", I jumped to "this is CUDA non-determinism, inherent, can't fix." Codex on the same problem refused to stop until he found the image-channel divergence. The difference is methodology, not raw skill.
- **How to apply:**
  - After each fix, restate the symptom in the user's words and ask "does this fix explain the symptom?"
  - If the answer is "partial" or "I'm not sure", treat it as "no" and keep enumerating.
  - "CUDA non-determinism" / "inherent characteristic" is the LAST hypothesis to accept, not the first.

### Rule 5: When the user gives a symptom that uses the word "一直/consistently/always", the answer is NOT stochastic.

- User said: "**online 能一直复现**，offline 没出现过 3 个". I treated this as "with noise, both paths land in different neighborhoods". Wrong. "一直复现" is a strong signal of **deterministic systematic** divergence.
  - The right reaction is: "what's the same in every online run that's not in any offline run? something on the path must always trigger differently."

### Specific PR #3444 lesson (2026-05-12)

- I spent ~hours auditing seed propagation, cond VAE generator handling, deterministic mode tradeoffs.
- Codex spent ~time on the same problem, ran image diffs alongside prompt diffs, found `input_1_0.png` is RGBA with 57671 transparent pixels, fixed `_load_input_images` to normalize-RGB when Hunyuan-aware API is used.
- Codex's fix is a single ~10-line patch with conservative gating. Mine (cond VAE) is orthogonal and only addresses within-path drift, not the cross-path bias.
- Memory cost vs root-cause finding: I had `painterly_silent_bugs.md` flagging similar `.sample()`-without-generator class, but I missed the much simpler upstream "PIL mode" silent bug. **Old memories can bias toward known-similar-but-not-actually-this bugs.**

### Cross-references

- CLAUDE.md B12 (style/quality bias 类 bug 先静态 diff)
- CLAUDE.md B14 (prior session 的"X 已证伪"标记只对具体 hypothesis 成立)
- CLAUDE.md B20 (尺寸异常 prompt → AR → bridge → DiT 逐层 trace) — extend mentally to "semantic异常 prompt + image + sampling → AR → ..."
- CLAUDE.md P3 (完整链路而非单点)
- [[seed-determinism-audit]]（seed determinism audit）（此前结论覆盖了一半问题，不能把它当成完整答案）

## 决策与踩坑

### Rule 1: Systematic ≠ stochastic. Classify first.

- **Why:** "CUDA / MoE non-determinism" is a tempting last-resort explanation for cross-path bias because (a) it's a known real thing for some models including HunyuanImage-3.0 (see CLAUDE.md B19), and (b) it sounds technical.
  - But it explains **noise within a path**, not **systematic bias between paths**. If you invoke it for cross-path bias you're projecting a known phenomenon onto an unrelated bug.
