---
name: 2026-05-05-painterly-conditioning-ablation-03
description: 2026-05-05 用 HI3_DISABLE_COND_VAE / HI3_DISABLE_COND_VIT 做三轮 IT2I 消融（ablate1 关 vae、ablate2 关 vit、ablate3 双关，painterly 反而更强）：painterly 独立于所有 conditioning 通路，剩余嫌疑在 DiT body、vllm 共享 op 或 torch 2.11 / cuDNN 13 回归
metadata:
  scope: 只收 cond_vae / cond_vit 双消融的三轮结果、结论与剩余嫌疑面；rebase 排除归 2026-05-05-painterly-conditioning-ablation-01，数值审计归 2026-05-05-painterly-conditioning-ablation-02，最终根因归 2026-05-06-painterly-root-cause-01、2026-05-06-painterly-root-cause-03
---
# 2026-05-05 — Cond_vae / cond_vit 双消融 → painterly 与 conditioning 路径完全无关

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-05-painterly-conditioning-ablation-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-05-painterly-conditioning-ablation-03`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：Cond_vae / cond_vit 双消融 → painterly 与 conditioning 路径完全无关
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **实验**：env-gate `HI3_DISABLE_COND_VAE=1` / `HI3_DISABLE_COND_VIT=1` 跳过 `forward_call` 里对应 `instantiate_*_tokens` 调用。三轮 IT2I：
  1. **ablate1**（关 cond_vae 留 cond_vit）：painterly 仍在；矩形从锐利平面 → 模糊 3D 立方体（cond_vae 主导精确空间布局）
  2. **ablate2**（关 cond_vit 留 cond_vae）：painterly 仍在；矩形布局跟 baseline 几乎一致
  3. **ablate3**（双关）：painterly **更猛**（毛茸茸 + 紫砖墙 + 油画感更强），矩形完全消失，但 painterly 风格反而更纯粹
- **用户补充**：之前会话验证过"把 HF AR 输出注入 omni T2I 路径，painterly 也在"——AR latent token 也不是 painterly 来源。
- **结论**：painterly **完全独立于所有 conditioning 通路**（cond_vae / cond_vit / AR latent token / cond cot text）。painterly bias 写在 **DiT body 内部 forward** 或 **vllm 0.20 / torch 2.11 / cuDNN 13 共性回归**，不在 vllm-omni 自己的装配代码里。
- **剩余嫌疑面**（按可能性）：
  1. `vllm.model_executor` 共享 op (RMSNorm batch-invariant rewrite / Attention layer batch-invariant dispatch / SDPA 后端选择) 在 PyTorch 2.11 + cuDNN 13 下数值漂移
  2. DiT transformer body 内部 cross-attn / MoE forward
  3. final_layer (UNetUp) 把 hidden_states 转 noise prediction 时偏
- **对未来的提醒**：
  - ablation 实验比 dump 数值更直接定位「风格 bias」类 bug（数值统计看不出方向性偏移）
  - 别再继续在 cond_vae / cond_vit 上做实验——已彻底排除
  - 下一步该 dump 的是 DiT body 入口/出口 hidden_states + final_layer 输入/输出，或者直接做 vllm-omni vs vllm 0.19 + torch 2.10 的精度回归 bisect
