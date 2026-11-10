---
name: rules-npu-graphs
description: "VoxCPM2 规则 VOXCPM2-NPU-1a：NPU adapter 在模型构造后幂等包装 feat_decoder.estimator.forward(x,mu,t,cond,dt)，用 NPUExactGraphRunner 的 exact-input gate 与 8 个 graph 的预算，不支持时保持 eager，graph_tools 延迟导入（PR #7275）"
metadata:
  scope: 只收 VOXCPM2-NPU-1a 一条规则；请求噪声 VOXCPM2-2a 与 LocDiT 设置 VOXCPM2-3a 归 voxcpm2-rules
---
# VoxCPM2 NPU estimator graph 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/voxcpm2/rules-npu-graphs.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7275
- 置信度（confidence）：high
- [VOXCPM2-NPU-1a] NPU graph 只包装已加载 LocDiT estimator 的 exact tensor 调用
  - 触发：修改 NPU VoxCPM2 platform adapter、constructor patch、estimator forward 或 platform resolution。
  - 强制：模型构造/权重加载完成后，NPU adapter 幂等包装 `feat_decoder.estimator.forward(x,mu,t,cond,dt)`，使用 `NPUExactGraphRunner` 的 exact-input gate 和有限 graph budget（本提交为 8）；不支持必要 NPU graph APIs 时保留 eager。CFM solver、request-local噪声、feature encode 与 VAE decode 保持各自原路径，不能把 estimator graph 等同完整 decode graph。
    - `graph_tools` 只在真正 NPU worker setup 延迟导入；访问 platform 时使用模块当前值，避免 inspection import 初始化 NPU或保存未解析 sentinel。CUDA unified decode graph 的 scheduler deferral 仍由 CUDA capability 选择。
  - 验收：CPU contract 验证延迟 import、幂等 patch、正确五 tensor wiring、unsupported API eager 和 NPU 不触发 CUDA waiting deferral；真实 NPU 另核对 estimator eager/replay 数值、exact signature miss、graph budget 与多请求 seed/生命周期。^[PR #7275]

## 决策与踩坑

- [VOXCPM2-NPU-1a] 禁止：在模型 inspection 子进程提前初始化 NPU；重复 constructor patch 或重复包装 estimator；把 NPU fast path塞进硬件 YAML 或修改共享 runtime knobs 来假冒统一能力；把 CPU mock 或单次 Atlas A2观察当成真实 NPU parity/通用性能证明。
