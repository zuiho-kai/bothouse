---
name: 2026-05-06-painterly-silent-bugs-01
description: 2026-05-06 painterly fix 期间的 silent correctness bug：传给 DiT 的 prompt_dict 用了 user_prompt key，而 pipeline_hunyuan_image3.py:1294 只读 p.get("prompt") or ""，img2img 因走 prompt_token_ids 视觉不受影响，t2t / t2i_recaption 才会空 prompt；解法是传字段前 grep 消费侧 dict.get
metadata:
  scope: 只收 user_prompt 与 prompt key 静默 fallback 这一条；AR 带图 greedy 不稳定与 VAE encode 漏传 generator 归 2026-05-07-painterly-silent-bugs-02
---
# 2026-05-06 — `user_prompt` vs `prompt` 离线 bug 我跑了 5 次都没踩到，被同事一句话点出

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-06-painterly-silent-bugs-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-06-painterly-silent-bugs-01`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：`user_prompt` vs `prompt` 离线 bug 我跑了 5 次都没踩到，被同事一句话点出
- 影响范围：repos/vllm-omni/models/hunyuan-image3

### 原文件说明

### Painterly bug — silent correctness bugs

- painterly fix 期间踩到的两个"代码不崩、视觉看起来 OK，但实际是错的"silent correctness bug：dict key 静默 fallback、VAE encode 漏传 generator。共性是**我的工具栈正好不监测被 silent 掩盖的字段**。根因和总览见 [[painterly-overview]]（Painterly 错题索引）。

---

- **症状**：cr/pr3107-fix 的 `prompt_dict = {"prompt_token_ids": ..., "user_prompt": p, ...}`，我跑 IT2I 5 次（baseline / ablate1/2/3 / cuDNN_L1 / moe_fp32）全部成功出图，painterly 修复验证通过。同事跑离线推理时报"有问题"，要求改 `"user_prompt"` → `"prompt"`。
- **根因**：DiT pipeline `pipeline_hunyuan_image3.py:1294` 只读 `p.get("prompt") or ""`，**完全不识别 `user_prompt` key**。我传 `user_prompt`，DiT 拿到的 `prompt = [""]` 空字符串。
- 为什么我没踩到这个 bug：
  1. **silent fallback `or ""`**：`p.get("prompt") or ""` 在 key missing 时返回空字符串而不是抛异常 → 代码不崩
  2. **IT2I 实际生成走 `prompt_token_ids` → AR → DiT cross-attn 路径**，不依赖 `prompt` 字符串 → 视觉输出正确
  3. **我只测了 img2img 一种模式**，t2t / t2i_recaption 等**主要靠 `prompt` 字符串**的模式没碰，那些模式空字符串就 garbage 了
  4. **我的工具栈是"看图"**，silent fallback 让代码不崩、图不受影响 → 我的工具栈不报警
- **同事怎么发现的（推测）**：直接 grep `pipeline.*\.get\(` 看 DiT 实际读哪些 key，一眼看出 `user_prompt` 不在白名单。或者跑了 t2t 模式看到空 prompt。**这是"看消费侧"的路径，比"看生成侧 + 看输出"信息密度高得多**。
- **对未来的提醒**（已加到 CLAUDE.md B15 + style_bias_debug_methodology.md）：
  - 给 dict-shape API 传字段前必须 grep 消费侧 `dict.get(...)`：消费侧 key 白名单 = 上游可传的 key 清单
  - `dict.get("key") or fallback` 模式是 silent fallback 的典型陷阱，wrong key → empty fallback → 不崩 → silent correctness bug
  - 视觉/数值"输出 OK" ≠ 代码正确：你的工具栈可能正好不监测被 silent 掩盖的字段

---
