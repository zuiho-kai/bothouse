---
name: profiling-tp4-fp8-baseline
description: HunyuanImage3 tp4_fp8 profiling 基线（2026-04-27，hk01dgx036 H800 x8，20 step，1024x1024）：端到端 2.85s、transformer forward 1.147s、vae.decode 0.487s、单层 0.154s、峰值显存 32.8 GB、吞吐 0.35 req/s；tp2_fp8_sp2 与 tp2_fp8_cfgp2 未跑
metadata:
  scope: 只收 tp4_fp8 一组测量数据和其未补测的配置；AR 侧 graph 与 TP2 benchmark 归 ar-only-tp2-benchmark-runbook、ar-graph-online-profiling-2026-06-08
---
## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/profiling-tp4-fp8-baseline.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
- 测试时间：2026-04-27，节点 hk01dgx036（H800 80GB × 8），NUM_STEPS=20，NUM_PROMPTS=2，1024×1024
- **tp4_fp8 结果：**
  - 端到端延迟均值：2.85s
  - `HunyuanImage3Pipeline.model.forward`（全部 transformer layers）：1.147s
  - `HunyuanImage3Pipeline.vae.decode`：0.487s
  - `model.layers[0].forward`（单层）：0.154s
  - `model.layers[0].self_attn.forward`：0.059s
  - `model.layers[0].mlp.forward`：0.068s
  - 峰值显存：32.8 GB（4 卡共享）
  - 吞吐：0.35 req/s
- **Why:** tp2_fp8_sp2 和 tp2_fp8_cfgp2 因节点 GPU 全满未跑，待补充。
- **How to apply:** 对比 HF baseline 和其他并行配置时用此数据作参照。
