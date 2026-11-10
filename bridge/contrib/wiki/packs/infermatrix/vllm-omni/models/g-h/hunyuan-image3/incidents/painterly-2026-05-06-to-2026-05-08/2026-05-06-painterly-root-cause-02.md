---
name: 2026-05-06-painterly-root-cause-02
description: 2026-05-06 META REFLECTION：painterly 定位用了 5 小时错路径（rebase、数值 dump probe、cond 消融、cuDNN/TF32 flag）与 hint「FusedMoE」后 30 分钟的 diffusion vs model_executor MoE 静态 diff；根因是把风格 bias 当数值幅度漂移处理，并列出 anchor 错的三点与应早做的 diff
metadata:
  scope: 只收调查路径的元复盘（数值漂移与方向性 bias 的工具栈区别）；BF16 vs FP32 routing 的第一版根因归 2026-05-06-painterly-root-cause-01，被更正的真正机制归 2026-05-06-painterly-root-cause-03
---
# 2026-05-06 — META REFLECTION: 5h 走错工具栈，同事一个 hint 30 分钟定位

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-06-painterly-root-cause-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-06-painterly-root-cause-02`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：META REFLECTION: 5h 走错工具栈，同事一个 hint 30 分钟定位
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：painterly bug 实际定位用了**两条路径**：
  - 错的（5h）：rebase + 数值 dump probe（VAE encode / instantiate / patch_embed）+ cond ablation × 3 + cuDNN/TF32 stability flag → 全部不修
  - 对的（30min after hint "FusedMoE"）：单 Explore agent 静态 diff vllm-omni `diffusion` 版 vs `model_executor` 版 MoE → 当场发现 BF16 vs FP32 gate routing 差异
- **根因（meta level）**：把"风格 bias"类 bug 当"数值幅度漂移"类 bug 处理。两者用完全不同工具栈：

| 类型 | 表现 | 工具 |
|---|---|---|
| 数值幅度漂移 | inf/nan、saturation、值爆炸 | dump mean/std/min/max |
| **方向性 bias**（painterly/blur/style shift）| 每层数值都健康，但 expert dispatch 决策每层偏一点累积 | **代码 diff vs HF reference**，dump 看不出来 |

- painterly 的指纹不在 hidden_states 统计里，写在 expert routing histogram 里 —— 我从头到尾没看过那个。我打的 6 个 BUG-PROBE 全是"找数值不健康的迹象"，但 BF16 routing 漂移恰好不会让数值不健康。
- **为什么 anchor 错**：
  1. 沿用 prior session "qwenimage 也有 → cuDNN/PyTorch/vllm 0.20 共享 infra 回归"的框架。**这个框架可能只是"两个团队都漏了同款 fix"**，不必然指向共享 infra。
  2. 视觉症状 "rectangle painterly + prompt 改不了" → 推 cond image 通路 bug → 沉到 conditioning 链路。但 conditioning 跟 MoE routing 是不同 op layer，逻辑上 routing bias 也能产生这种症状（layer-wise 影响所有 token）。
  3. lastwords 写 "MoE routing 已证伪" → 我视而不见地信任。**那只证伪了一个具体 hypothesis**（router_logits 传错），不证明 MoE 整体清白。dtype 是 different bug。
- **hint "FusedMoE" 起的作用**：打破 anchoring，从"共享 infra"切到"具体组件"，触发 diff 思维 —— **vllm-omni 自己仓库就有两个 MoE 实现**（diffusion vs model_executor），diff 它俩立刻看到 `params_dtype=torch.float32` 的差异。
- **应该早做的事**：session 第一小时 grep `MoE / FusedMoE / gate` 在 vllm-omni `diffusion/` 跟 `model_executor/` 子目录里，**diff 两个实现** —— 30 分钟内 painterly bug 暴露。**这一步比所有 dump probe 都信息量大**。

---
