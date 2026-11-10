---
name: 2026-05-05-painterly-conditioning-ablation-02
description: 2026-05-05 用 BUG-PROBE env-gate dump vae_encode 入出参、instantiate_vae_image_tokens 与 patch_embed(UNetDown) 的统计，并与 HF modeling_hunyuan_image_3.py 做字节级 diff：数值层完全清白（vae latent std=1.0065，仅 sample() 未传 generator 的差异），别再在 cond_vae 链路 dump
metadata:
  scope: 只收 cond_vae 链路（vae_encode、instantiate_vae_image_tokens、patch_embed）的数值审计与字节级 diff；rebase 排除归 2026-05-05-painterly-conditioning-ablation-01，cond_vae / cond_vit 消融归 2026-05-05-painterly-conditioning-ablation-03
---
# 2026-05-05 — VAE encode + instantiate_vae_image_tokens + UNetDown 全链路数值审计 → 数值层完全清白

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-05-painterly-conditioning-ablation-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-05-painterly-conditioning-ablation-02`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：VAE encode + instantiate_vae_image_tokens + UNetDown 全链路数值审计 → 数值层完全清白
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **实验**：BUG-PROBE env-gate dump 三个关键点的统计：
  - `vae_encode` 入参 image / 出参 latent
  - `instantiate_vae_image_tokens` 入口 images / 出口 scattered hidden_states
  - `patch_embed` (UNetDown) 输出 image_seq
- 跑 IT2I 收 dump，同时静态字节级 diff vllm-omni vs HF (`modeling_hunyuan_image_3.py`) 的相关方法。
- **关键数据**（cond image 真实输入路径）：
  - `vae_encode` 入参 (1,3,1,1024,1024) FP32 min=-1 max=1 mean=0.408 std=0.443 ✓ 标准 VAE 输入
  - `vae_encode` 出参 (1,32,64,64) FP32 mean=-0.4114 std=1.0065 ✓ 标准 VAE latent
  - `instantiate_vae_image_tokens` 入口 images mean=-0.4114 std=1.0065 ← **逐位匹配 vae_encode 输出**
  - `patch_embed` 输出 image_seq (2,4096,4096) BF16 std=0.1031 ✓ 合理 patchified embedding
  - scatter 后 hidden_states 演化：std 从 0.0157 → 0.0736 → 0.1001（gen + cond + vit 依次注入）✓ 无溢出
- **字节级 diff**（vllm-omni vs HF snapshot）：
  - `vae_encode`：唯一差异是 vllm-omni `latent_dist.sample()` 没传 generator，HF 传了。autocast `dtype=torch.float16` 等价（HF config `vae_autocast_dtype: float16` 验证）
  - `instantiate_vae_image_tokens`：标准路径几乎一致（HF 多一个 `if hidden_states is None` 分支用于 KV-reuse 优化模式，vllm-omni 第一步路径不走它）
  - `UNetDown` (patch_embed class)：完全等价，仅格式差异
- **结论**：painterly **不在 cond_vae conditioning 链路的任何数值层**。VAE encode→装配→patch_embed 全部健康。
- **对未来的提醒**：
  - 别再继续 dump cond_vae 链路上的数值统计——已是死胡同
  - HF `vae_encode` 在 `modeling_hunyuan_image_3.py` 不在 `hunyuan_image_3_pipeline.py`，grep 别只搜 pipeline 文件
  - `vae_autocast_dtype` 是 HF model config 字段（值 `float16`），vllm-omni 硬编码 `torch.float16` 等价

---
