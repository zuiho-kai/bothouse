---
name: rules-request-rng
description: "Request RNG 与 MTP graph 边界规则：EXEC-RNG-1a（PR #8009，_talker_mtp_forward 先按 request/device 缓存逐行 generator 再决定 graph mode，任一行有显式 generator 时整个 MTP 调用 eager）与 EXEC-RNG-1b（PR #8341，batched_seeded_exponential_supported 的 NVIDIA Triton/Philox kernel 由 current_platform.is_cuda() 放行，ROCm/HIP 走 Torch ordered row draws）"
metadata:
  scope: 只收显式 seed 与 whole-MTP graph 的决策顺序、seeded exponential 的平台门禁两条规则；请求随机状态跨 batching 与 yield 的所有权 EXEC-1c 归 rules-bridge-batch-1，Talker-MTP graph 能力三态 EXEC-4c 归 model-executor-rules-2，Breeze graph RNG 的 EXEC-17a 归 rules-breeze-rocm
---
# Request RNG 与 MTP graph 边界

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-request-rng.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8009；PR #8341
- [EXEC-RNG-1a] 显式逐行 generator 必须先于 whole-MTP graph 决策
  - 触发：修改 runner _talker_mtp_forward、graph wrapper 或 tts_local_seed 的 generator 创建。
  - 强制：先解析并按 request/device 缓存逐行 generator，再决定 graph mode；任何 row 有显式 generator 时，整个 MTP 调用必须 eager 且只取真实 decode batch 行。无 generator 且 wrapper 受支持时保留 graph replay；request 结束回收 generator。
  - 验收：CUDA/Ascend graph-wrapper control 覆盖 mixed seeded/unseeded、seed0、同请求多步与 request teardown；断言真实 Python MTP 消费 generator、各行状态独立，generator-free batch 仍 replay。 ^[PR #8009]
- [EXEC-RNG-1b] seeded exponential 的 NVIDIA kernel 不能由 tensor.is_cuda 单独放行
  - 触发：修改 batched_seeded_exponential_supported 或直接 fill_exponential_rows 调用。
  - 强制：NVIDIA Triton/Philox kernel 必须由 current_platform.is_cuda() 放行；ROCm/HIP及其他平台使用 Torch ordered row draws。无 rows 时每 generator 对应 flatten 后等大连续slice；有 rows 时严格沿所选行顺序，None 沿默认 generator 消耗。
  - 验收：平台dispatch、五次重复sample、seeded/default generator 完整state、FP32/FP64、grouped-codebook、selected-row、sharedgenerator及mixedseed controls都与 Torch逐行 reference 对照。 ^[PR #8341]

## 决策与踩坑

- [EXEC-RNG-1a] 禁止：把 generator 参数传给只 replay startup dummy capture 的 wrapper 后声称 seed 被消费；按 model 关闭整条 stage 的 graph，或用 padded rows 消耗 seeded RNG。
- [EXEC-RNG-1b] 禁止：把 HIP 的 tensor.is_cuda 当作 NVIDIA capability；仅替换 fast_logf 就宣称跨平台 RNG 等价；让直接 Higgs/codebook caller 绕过平台门禁或重排共享 generator 的抽样。
