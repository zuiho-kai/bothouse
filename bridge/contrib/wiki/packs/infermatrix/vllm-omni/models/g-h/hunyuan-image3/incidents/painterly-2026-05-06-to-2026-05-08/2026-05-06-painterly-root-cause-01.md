---
name: 2026-05-06-painterly-root-cause-01
description: 2026-05-06 Painterly 根因的第一版结论（后被 2026-05-06-painterly-root-cause-03 更正）：diffusion 侧 HunYuanSparseMoeBlock（hunyuan_image3_transformer.py:1455+）gate 未设 params_dtype=torch.float32 走 BF16 routing，对照 AR 侧 HunyuanImage3SparseMoeBlock 的 FP32 修法、4 处 patch、视觉验证与可解释的全部现象
metadata:
  scope: 只收 BF16 vs FP32 gate routing 这版根因、4 处 patch 与视觉验证；5h 错路径的元复盘归 2026-05-06-painterly-root-cause-02，被同事更正后的真正机制（forward pre-hook 双调用）归 2026-05-06-painterly-root-cause-03，总览归 painterly-overview
---
# 2026-05-06 — ROOT CAUSE FOUND: BF16 vs FP32 gate routing in DiT MoE

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-06-painterly-root-cause-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-06-painterly-root-cause-01`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：ROOT CAUSE FOUND: BF16 vs FP32 gate routing in DiT MoE
- 影响范围：repos/vllm-omni/models/hunyuan-image3

### 原文件说明

### Painterly bug — 调查总览 + 根因（连同事后更正）

- HunyuanImage3 IT2I "扁平卡通输入 → 油画风输出" painterly drift 的核心调查链：5h 错路径 + 30min 在 hint 后定位 + 事后被同事二次更正。完整调查链和相关错题见 [[painterly-overview]]（Painterly 错题索引）。

---

- **Painterly bug 根因（实锤）**：vllm-omni 的 **diffusion-side** `HunYuanSparseMoeBlock` (`vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py:1455+`) 创建 `self.gate = ReplicatedLinear(...)` 时**没指定 `params_dtype=torch.float32`**，默认走 BF16。
  - HF reference (`modeling_hunyuan_image_3.py`) 严格用 FP32 gate routing。DiT 32 层 × top-k=8（256 expert 选 top-8），BF16 routing 在 logits 接近时**翻牌**，逐层累积 → painterly bias attractor。
- **讽刺的是**：vllm-omni 仓库**已经有正确实现** —— `model_executor/models/hunyuan_image3/hunyuan_image3.py:HunyuanImage3SparseMoeBlock`（这是 HF AR 模型用的）。它继承 `HunYuanSparseMoeBlock` 且修了 routing：
  - `params_dtype=torch.float32` for `self.gate`
  - 显式 `hidden_states.float()` cast 后跑 gate
  - FP32 `softmax` + `topk` + `clamp(min=1e-8) + divide` renormalize
  - pack `(topk_weights, topk_indices)` 喂 `SharedFusedMoE` 的 `custom_routing_function=_hunyuan_image3_unpack_packed_topk`，绕开 vllm 的 BF16 `topk_softmax` CUDA op
- 但 **diffusion-side 漏了同步这套修复**。一年前的事实：HunyuanImage3 训练时就要求 FP32 routing（它在 HF `hunyuan_image_3_pipeline.py` 里就写了 `with torch.autocast('cuda', enabled=False)` 包 routing）。AR 那边修了（model_executor 版），DiT 这边遗漏。
- **修复 patch**（4 处改动 in `hunyuan_image3_transformer.py:HunYuanSparseMoeBlock`）：
  1. **line 1486-1492**：`self.gate = ReplicatedLinear(..., params_dtype=torch.float32, quant_config=None, ...)`
  2. **line 1483-1485**：加 `self.top_k = top_k`（forward 需要）
  3. **line 1514-1527**：`HunyuanFusedMoE(...)` → `SharedFusedMoE(..., custom_routing_function=_hunyuan_image3_unpack_packed_topk, pcp_size=1)`（注意 `pcp_size=1` 不能删，否则触发 `prefill context parallel group is not initialized` AssertionError）
  4. **line 1529-1545 forward**：FP32 routing pipeline — `self.gate(hidden_states.float())` → softmax (fp32) → topk → clamp+divide → cast topk_weights to bf16 → cat[topk_weights.float(), topk_indices.float()] → 喂给 `self.experts` 作为 `router_logits`
- **视觉验证**（cr/pr3107-fix on /rebase/vllm-omni/, vllm 0.20.0 + torch 2.11.0+cu130）：
  - baseline (BF16 routing): painterly 毛茸茸猫 + 水彩矩形 + 纸纹背景
  - patch 后: clean cartoon 平涂橙猫 + 锐利彩色矩形 + 干净浅蓝背景，跟 HF reference `output_hf_dit.png` 风格一致
- **为什么这能解释一整轮调研所有现象**：
  - ✅ painterly 不在 cond_vae / cond_vit / VAE encode / 装配 / patch_embed 数值层 —— routing bias 是 **layer-wise，影响所有 token，跟 conditioning 无关**
  - ✅ 注入 HF AR cot 不修 —— DiT 内部 routing 还是 BF16
  - ✅ rebase vllm-omni main 不修 —— main 没改 diffusion-side moe
  - ✅ ablate1/2/3 全 painterly —— routing bias 持续存在
  - ✅ TF32 关掉无效 —— 不是 kernel-level，是 dtype 选择问题
  - ✅ HF reference 跑 cartoon —— HF 用 FP32 gate
  - ✅ QwenImage 同样问题（colleague 报告）—— 大概率同类 bug：MoE gate dtype 没对齐 HF
- **对未来的提醒**：
  - 接入 MoE 模型走 vllm 0.20+ 时，`gate` 的 `params_dtype` **必须**显式指定（不要靠默认）。HunyuanImage3、Qwen3-MoE、DeepSeek-V2 等所有"训练时 FP32 routing"的模型都要这么搞
  - 当一个仓库**同时有 AR 版和 DiT 版**模型代码（model_executor/ vs diffusion/），**两边的 MoE 实现必须保持同步**。AR 那边修过的 bug（如 FP32 routing）DiT 这边大概率也有
  - 调试**风格漂移类 bug**（painterly / sketch / oil）时，**MoE routing 是首选嫌疑** —— 因为风格 bias 跟"逐层 expert 选择微偏 → DNN 聚合到不同 attractor"对得上。逐 op 数值统计 dump 看不出来（每层 std/mean 健康，但 expert 选择已偏）

---
