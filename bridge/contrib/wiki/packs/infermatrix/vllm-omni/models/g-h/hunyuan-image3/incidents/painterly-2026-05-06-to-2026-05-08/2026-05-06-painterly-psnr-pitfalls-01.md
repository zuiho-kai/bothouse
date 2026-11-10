---
name: 2026-05-06-painterly-psnr-pitfalls-01
description: 2026-05-06 HF 自己跟自己重跑 PSNR 也只有 10-12 dB（full pipeline 11.78、DiT-only 10.86，vllm-omni 注入 HF cot 15.16）：HunyuanImage-3.0-Instruct 的 HF 实现本身不 deterministic，vllm-omni 对 HF 的 10.49 dB 落在 HF 重跑方差内；验证 cross-impl 对齐前先测 reference 自身可复现性（CLAUDE.md B19）
metadata:
  scope: 只收 HF 自重跑 PSNR 方差与对 painterly fix 验证的影响；凭空想象 KV cache transfer 归 2026-05-06-painterly-psnr-pitfalls-02，未对齐 fair-comparison 参数的 PSNR 归 2026-05-06-painterly-psnr-pitfalls-03
---
# 2026-05-06 — HF 自己跟自己重跑 PSNR 也只有 10-12 dB

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-06-painterly-psnr-pitfalls-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-06-painterly-psnr-pitfalls-01`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：HF 自己跟自己重跑 PSNR 也只有 10-12 dB
- 影响范围：repos/vllm-omni/models/hunyuan-image3

### 原文件说明

### Painterly bug — PSNR 验证 / 跨实现对比 / 凭空想 KV 复用

- painterly fix 之后做 vllm-omni vs HF 跨实现验证时三个 PSNR 类踩坑：HF 自己跟自己 PSNR 都只 10-12 dB / 凭空编"KV cache transfer"机制 / fair-comparison 没对齐就跑。根因和总览见 [[painterly-overview]]（Painterly 错题索引）。

---

- **实验设置**：
  - HF run a：`model.generate_image(prompt=..., image=..., seed=42, do_sample=False, ...)`
  - HF run b：完全相同的调用（同进程、同 GPU、同 seed、同 do_sample=False）
  - 对比 a vs b 输出图 PSNR
- **结果**：

| 配置 | PSNR a vs b |
|---|---|
| HF full pipeline (cot regen + DiT) | **11.78 dB** |
| HF DiT-only (cot fixed via `cot_text=`+1 行 modeling patch) | **10.86 dB** |
| vllm-omni inject HF cot | 15.16 dB（**比 HF 还稳定**）|

- **结论**：HunyuanImage-3.0-Instruct **HF 实现本身**就不是 deterministic 的，即使所有参数固定（greedy / 同 seed / 同 device），跑两次 PSNR 也只有 ~11 dB。
- **根因**（推测，未逐个隔离）：
  - cuDNN benchmark mode 跑两次选不同 conv 算法
  - `device_map="auto"` 多 GPU 下 NCCL all-reduce 顺序非 deterministic
  - DiT initial noise `torch.Generator(seed=42)` 在不同 cuda stream 调用顺序下结果不同
  - GPU atomic ops 默认 non-deterministic
- **对 painterly fix 验证的影响**：
  - vllm-omni vs HF 的 10.49 dB cross-impl PSNR **已经在 HF 自身重跑方差（10.86~11.78 dB）范围内**
  - "vllm-omni 跟 HF 不 byte-equal"这个标准**在 HunyuanImage3 上无意义**——HF 自己都达不到
  - 视觉对齐（cartoon vs painterly）是真实可观察的 fix，PSNR 不是合适的金标准
- **对未来的提醒**（已加 CLAUDE.md B19）：
  - 用 PSNR 验证 cross-impl 对齐前必须**先测 reference 实现自身的 reproducibility**。如果 reference 自己 a vs b 都拉不到 25+ dB，那 cross-impl PSNR 同水平**完全合理，不是 bug**
  - 视觉判断 + 端到端功能验证 > 数值 PSNR 在大部分 generative model cross-impl 场景

---
