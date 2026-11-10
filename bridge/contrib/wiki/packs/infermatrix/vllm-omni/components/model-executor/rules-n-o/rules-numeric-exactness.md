---
name: rules-numeric-exactness
description: "数值精确性与平台可移植性规则（PR #8562）：VLLM-OMNI-PR8562-TRITON-HIP-RN——Triton kernel（moss_tts/first_frame_special.py 的 _rotate）里 CUDA libdevice 的 add_rn / mul_rn 须用单一 tl.constexpr 按平台编译期分支，HIP/ROCm 走 FP32 乘加；VLLM-OMNI-PR8562-GRAPH-BUCKET-ORACLE——test_breeze_tts_2_graphs.py 的 31→32 bucket replay eager oracle 须在同一 padded workspace、同一 noise 上做 atol=0 比较"
metadata:
  scope: "只收 PR #8562 的两条规则：Triton 显式舍入算子的平台分支和 graph bucket replay 的 eager oracle 对齐；Breeze graph RNG 与 depth-layer autotune 的平台分支 EXEC-17a 归 rules-breeze-rocm，显式 seed 与抽样边界归 rules-request-rng"
---
# 数值精确性与平台可移植性规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-numeric-exactness.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-10；updated: 2026-10-10
- 来源（sources）：PR #8562
- [VLLM-OMNI-PR8562-TRITON-HIP-RN] Triton libdevice 显式舍入算子必须按平台编译期分支
  - 触发：在 `vllm_omni/model_executor/models/` 下的 Triton kernel（如 `moss_tts/first_frame_special.py` 的 `_rotate`）调用 CUDA libdevice 内建（`add_rn`/`mul_rn` 等显式舍入算子），或修改这类 kernel 的跨平台数值路径（本例的修复对象是 AMD READY R2-01 暴露的 MOSS first-frame attention 失败）。
  - 强制：CUDA-only 的 libdevice 算子必须在 Triton 编译期用单一 `tl.constexpr` 按平台选择（PR 的形态：模块级 `_CUDA_RN_OPS = current_omni_platform.is_cuda()` 作为 constexpr 默认参数）：NVIDIA CUDA 保留显式 round-to-nearest 路径，非 CUDA 平台（含 HIP/ROCm）改走可移植的 FP32 乘加表达式（`value_fp32 * cosine + signed_partner * sine`）；
    - 与原始实现（reference attention）的既有数值对照不得因平台分支而放松。
  - 验收：审查者核对平台选择是单一编译期常量、CUDA 与可移植两种表达式在 kernel 内显式分支、既有数值对照未放松，并要求申请者分别给出两条平台路径的数值测试和修复后目标平台的 CI 通过证据。
    - PR #8562 自身的证据不满足后两项：所示 diff 除 `_rotate` kernel 外还改了两个测试文件——`test_audio_embed_kernel.py` 把随机 reduction 断言放宽为默认 `assert_close` 并新增可精确表示的 bitwise 用例、`test_breeze_tts_2_graphs.py` 重写 Breeze graph oracle——但所示改动都在 CUDA 上运行，不触及 `_rotate` 的任何平台分支；
    - PR body 明确保持 R2-01 `NonBlocking` 并把绿色 soak 推迟到后续 promote PR，证据未附修复后的 AMD CI 通过记录。^[PR #8562]
- [VLLM-OMNI-PR8562-GRAPH-BUCKET-ORACLE] graph bucket replay 的 eager oracle 必须对齐 padded workspace 与同一 noise
  - 触发：修改 `tests/model_executor/models/test_breeze_tts_2_graphs.py`，或其他把 graph replay 与 eager oracle 对照的 bucket padding 测试（如 31 个请求 replay 进捕获的 32 请求 bucket）。
  - 强制：oracle 必须在图捕获的同一 padded workspace 上执行（clone `entry.hidden`/`entry.first`，按 `entry.parameters`、`entry.guidance_scale` 与 greedy 标志走 eager `_generate_frame`），传入图采样所用的同一 noise 张量，只对前 `batch` 个 live row 做 `atol=0, rtol=0` 比较；noise 用独立 reference generator 逐 codebook `exponential_` 对账；
    - 保留 graph 复用、inactive/retired generator、retained 输出所有权等精确断言。
  - 验收：31→32 bucket 用例按 workspace/noise 对齐后的 live-row 精确比较通过；`temperature > 0` 断言 `entry.noise` 非空且逐元素等于 reference，`temperature == 0` 断言为 `None`；同一 graph_key 复用同一 `BreezeDepthGraph` 与输出所有权断言仍在。^[PR #8562]

## 决策与踩坑

- [VLLM-OMNI-PR8562-TRITON-HIP-RN] 禁止：让 HIP 平台编译进 Triton HIP mapping 中不存在的 libdevice 调用（PR 记录 `add_rn` 与配对的显式 RN 算子在 HIP mapping 均无映射）；把平台判断做成 kernel 内运行时分支或多个互相不一致的常量。
- [VLLM-OMNI-PR8562-GRAPH-BUCKET-ORACLE] 禁止：用更小的独立 eager batch（逐请求 1-shape 执行、各自生成 noise）与 padded graph 的采样 token 逐元素相等当判据——不同 batch shape 可能选中不同 kernel（PR 测试注释原话为 can select different kernels），该判据不可靠；temperature=0 时断言 noise 存在；或借重构之机删除 exact 断言。
