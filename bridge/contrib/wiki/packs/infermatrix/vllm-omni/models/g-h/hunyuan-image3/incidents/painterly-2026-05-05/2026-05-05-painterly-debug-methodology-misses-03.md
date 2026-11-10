---
name: 2026-05-05-painterly-debug-methodology-misses-03
description: 2026-05-05 把 transformers.Siglip2VisionModel swap 成本地 vendor 的 Siglip2VisionTransformer 时连踩三个接口错（Config 无 items、extras 未定义、use_return_dict 缺失）：数值等价不等于接口等价，swap 前先做接口 diff 矩阵再写 adapter shim
metadata:
  scope: 只收 swap SigLIP2 实现时的三个接口错与接口对账做法；SigLIP2 std 误判归 2026-05-05-painterly-debug-methodology-misses-02，远端 patch 未回退归 2026-05-05-painterly-debug-methodology-misses-04
---
# 2026-05-05 — 尝试 swap SigLIP2 实现时连续踩 3 个接口错

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-05-painterly-debug-methodology-misses-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-05-painterly-debug-methodology-misses-03`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：尝试 swap SigLIP2 实现时连续踩 3 个接口错
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：把 `transformers.Siglip2VisionModel` swap 成本地 `vllm_omni.model_executor.models.hunyuan_image3.siglip2.Siglip2VisionTransformer`，依次撞上：
  1. `'Siglip2VisionConfig' object has no attribute 'items'` — 本地版 `Config(config)` 包装期望 dict
  2. `name 'extras' is not defined` — 之前 COT dump patch 时 anchor 串错改坏了变量名
  3. `'Config' object has no attribute 'use_return_dict'` — 本地版 forward 期望 `return_dict` 显式传入或 config 里有该 key
- **根因**：本地 SigLIP2 是从 HF snapshot **逐字 vendor**（`/mnt/models/.../siglip2.py`）来的，**不是** `transformers.Siglip2VisionModel` 的 drop-in replacement。两者构造签名、forward 签名、config 接口、kwarg 命名全有差异。我没先把这些差异列清楚就动手 patch + 跑，每跑一次撞一个错。
- **解法**：swap 不同实现前，先生成"接口 diff 矩阵"——把两侧的 `__init__` 签名、`forward` 签名、config 期望字段、return type 全列出来对比，再写 adapter shim 把所有差异在一处 reconcile，最后才 sed。
- **对未来的提醒**：
  - 当 commit 上写"swap A → B 因为它们等价" 时，"等价" 通常只指**数值**等价，**接口**几乎从来不等价。先审接口
  - "vendor 一份 HF 上游代码" 类型的 swap 容易踩这种坑：vendor 版本用了已 deprecated 的 API（这里是 `_prepare_4d_attention_mask`，transformers 5.10 要删）、没跟上签名 rename（`attention_mask` vs `pixel_attention_mask`）
  - 用户 push 回 "再犯错就从头审视，不要老是改出小问题再修" 之后，立刻停手做完整接口对账，**不要再迭代式修补**

---
