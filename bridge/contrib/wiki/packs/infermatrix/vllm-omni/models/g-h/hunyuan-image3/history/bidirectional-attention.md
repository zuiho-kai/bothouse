---
name: bidirectional-attention
description: HunyuanImage3 双向注意力分析（2026-04-09）：上游对图像 token 用 full attention、vllm-omni 全 causal；一行修复是把 hunyuan_image_3_moe 加进 vllm 上游 MM_PREFIX_LM_MODELS，is_mm_prefix_lm 只是对 joint_full 细粒度的近似
metadata:
  scope: 只收图像 token 双向注意力的差异、MM_PREFIX_LM_MODELS 一行修法与其近似局限；AR 侧 prompt 与 stage 转移的对齐归 alignment-inventory
---
## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/bidirectional-attention.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### 双向注意力（2026-04-09 分析）

#### 问题

- 上游 HunyuanImage3 对图像 token 用双向（full）注意力，文本 token 保持 causal。vllm-omni 当前全部 causal，图像 token 之间看不到彼此。

#### 修复方案

- 把 `"hunyuan_image_3_moe"` 加进 vllm 上游 `config/model.py` 的 `MM_PREFIX_LM_MODELS` 元组。一行改动。

#### 注意

- vllm 的 `is_mm_prefix_lm` 给所有多模态 token 统一开双向注意力。上游更细粒度（`joint_full` 区分 VAE/VIT/joint slice）。简单加 `is_mm_prefix_lm` 是近似，但比纯 causal 好很多。
- **Why:** 纯 causal attention 下图像理解质量会显著下降。
- **How to apply:** 提 PR 时需要同时改 vllm 上游的 MM_PREFIX_LM_MODELS。
