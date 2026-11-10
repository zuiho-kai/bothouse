---
name: rules-resident-graphs
description: "MiniCPM-o 4.5 Whole-Euler 与 resident graph 合同：MCPMO-GRAPH-1a Whole-Euler 的 backend 选择与共享 arena 生命周期（PR #8007、PR #8443）、1b resident slots 与 arena 共同服从 max_graphs、1c onset 与 continuation 合并保留逐行 cache offset、1d CFM ordinary TF32 与 HiFT 精度分离、1e exact encoder 与 HiFT 预捕、1f stock precapture 配置与失败策略（PR #8515）"
metadata:
  scope: 只收 MCPMO-GRAPH-1a 至 1f；legacy step-level CFM graph 与 padding 归 rules-cuda-graphs，输入 SigLIP/Whisper graph 归 rules-encoder-graphs，MRv2 的 cached ISTFT 归 rules-mrv2-state
---
# MiniCPM-o 4.5 Whole-Euler 与 resident graph 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-resident-graphs.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-09
- 来源（sources）：PR #8007；PR #8443；vllm_omni/model_executor/models/minicpmo_4_5/cuda_graph_wrapper.py；vllm_omni/model_executor/models/minicpmo_4_5/batched_token2wav.py；PR #8515
- 置信度（confidence）：high
- [MCPMO-GRAPH-1a] Whole-Euler 必须保持 backend 选择与共享 arena 的生命周期
  - 触发：修改 Code2Wav Whole-Euler capture/replay、micro-batch 分组或 attention arena。
  - 强制：CUDA Whole-Euler 捕获完整 Euler solve；显式 TRT stepper 存在时不构造或重放 Whole-Euler，`enable_whole_euler=false` 保留 step-level graph 路径。NPU 使用自己的 platform graph runner；新增 estimator 参数必须同步平台 patch 的签名。
  - 强制：所有 micro-batch 的 graph entry 在任何 replay 前一次性取得；后续 capture 若退休早先 graph，必须重新取得整组，不能一部分已更新 request cache 后再整体 eager。arena 的 input/output attention views 共用 storage；扩大该 storage 前先同步并退休引用它的自有 graphs。首个 capture 失败、尚无 cache entry 时也必须释放 arena。
  - 验收：同 bucket 的不同有效长度经过真实 masked attention 与 causal convolution 后，比较有效 mel、CNN/attention cache 并继续消费下一 chunk；检查 TRT 双开关、NPU estimator 签名、arena 首捕失败清理、storage growth 与整组重取。新版 Whole-Euler 总预算见 MCPMO-GRAPH-1b，不沿用旧版本满容量时不断整代重捕的策略。^[PR #8007] ^[PR #8443]
- [MCPMO-GRAPH-1b] resident slots 与 arena 必须共同服从 max_graphs
  - 触发：修改 Whole-Euler resident attention slots、fused DiT body、precapture 或 graph 上限。
  - 强制：slot pool 只在受支持的 fused body、FP32 attention cache 与 NVIDIA SM80+ tiled-attention 路径启用；不满足条件时保留 arena 路径。slot 保留 request 自己的 attention history，query 容量至少覆盖配置宽度与 200 帧，不能把不同请求的 cache 混为一条。
  - 强制：`len(_cache)+len(_slot_graphs)` 共同受 `max_graphs` 限制；arena、slot 的 lazy capture 与 precapture 都使用同一剩余预算。未命中且预算耗尽时返回未接纳，让调用方走有效 fallback；不得扩容预算或仅检查 arena cache。显式 `micro_batch_size` 和 `max_graph_batch` 仍优先于 scheduler 推导的默认值。
  - 验收：分别用 arena 与 resident slot 填满预算，再请求第三种 shape；确认预算未增长，precapture 不越界，未接纳路径可完成 eager solve；另核对显式 batch override 与 request history 的逐行 parity。真实性能数据需绑定 exact head、配置、硬件和 workload。^[PR #8443]
- [MCPMO-GRAPH-1c] onset 与 continuation 合并必须保留逐行 cache offset
  - 触发：修改 `cfm_onset_merge`、`cfm_row_offset_merge` 或 ragged Code2Wav batch。
  - 强制：混合 onset/continuation 时，CFM 路径不 stack 长度不同的 Conformer cache；`_stack_flow_cache(..., include_conformer=False)` 只跳过此路径不用的字段。每行按自身 attention offset 选择 noise slice、有效 key mask 和输出 cache；CFG 的 cond/uncond 行排列、CNN cache 与请求索引保持一致，HiFT 按可兼容的 cache shape 分组。
  - 强制：Whole-Euler 拒绝 mixed-offset shape 时按 offset 分组求解；同 offset 子组必须最终到达 step/eager 路径，不能因 `row_offset_merge` 开关再次递归进入同一 fallback。
  - 验收：混合新 onset 与已推进的 continuation；强制 graph replay 返回 `None`，验证有限次 fallback 完成并保持原行顺序；对每行 cache、有效 mel 与后续 chunk 做独立 parity。^[PR #8443]
- [MCPMO-GRAPH-1d] CFM ordinary TF32 必须与 HiFT 精度分开并保留旧配置键
  - 触发：修改 MiniCPM-o Code2Wav TF32 开关、fused kernels 或 graph capture 精度。
  - 强制：`MINICPMO_CODE2WAV_TF32` 优先于 shipping 键 `token2wav_allow_tf32`，再兼容 `code2wav_allow_tf32`；当前默认 ordinary `tf32`，显式 false/off 关闭。dense CFM QKV/MLP 的 `allow_tf32` 与 tiled attention 的 `input_precision="tf32"` 属同一 ordinary TF32 策略；CFM 调用恢复原全局 matmul policy，HiFT convolution 保持 IEEE FP32。
  - 验收：覆盖默认、环境优先级、两个 YAML 键、off 与旧 alias；检查 policy 恢复以及 capture 所用精度下的 DiT/cache parity。性能与音频质量结论分别绑定实际 precision，不从普通 TF32 kernel 或单元测试推出端到端质量等价。^[PR #8443]
- [MCPMO-GRAPH-1e] Code2Wav exact encoder 与 HiFT 预捕必须覆盖真实 continuation shape
  - 触发：修改 `cfm_encoder_cuda_graph`、Code2Wav precapture 或 HiFT exact chunk buckets。
  - 强制：Code2Wav flow encoder graph 的 API 默认关闭；bundled profile 可显式开启这一 CUDA continuation 优化；仅支持具备固定 position-encoding tables 的 CosyVoice2 upsample-Conformer，保留 eager onset、final/flush、其他 row/token/cache shape。graph key 覆盖实际 row 数、token width 与可达 cache 长度；无额外 padding。
    - 输出 views 会被下次 replay 改写，需保留时 clone。
  - 强制：权重加载后首个 `forward` 的 precapture 路径按配置预捕 HiFT，再用真实默认 prompt 特征准备 Whole-Euler 与 flow-encoder shapes；HiFT 仍只捕获 pre-iSTFT，iSTFT/finalize 保持原边界。不得把 initial/continuation width 默认视为已覆盖，检查 exact bucket 配置与实际预捕 key。Whole-Euler 预捕受 MCPMO-GRAPH-1b 的总预算约束。
  - 验收：枚举 streaming trim 后可达 cache shapes，逐 shape 比较 encoder 与 eager；对未支持的 layouts/widths 检查 eager，CUDA 测试另验证真实 capture 的 bit-exact replay；HiFT 检查 initial、steady、final chunk 与 retained output 的边界。^[PR #8443]
- 输入 SigLIP/Whisper graph 见 [[rules-encoder-graphs]]（encoder graphs）；legacy step-level CFM graph 与 padding 合同见 [[rules-cuda-graphs]]（CUDA graph 规则）。
- [MCPMO-GRAPH-1f] stock precapture 配置与各 wrapper 的失败策略分别保持
  - 触发：修改 MiniCPM-o bundled profile、flow encoder admission 或 HiFT/Whole-Euler precapture。
  - 强制：核对实际 profile 中 flow encoder enable、row/token/cache 资格、capture_after 与 graph 总预算；stock continuation HiFT exact buckets 包括 batch=1 的 4/28 帧。Whole-Euler startup 按剩余预算先捕稳态再捕 lookahead tail buckets。flow encoder 共享 pool 的 capture 失败为 terminal，需重启；
    - Whole-Euler 自身 capture 失败则 disable 并返回未接纳，按其 caller fallback。NPU stage-0 encoder graph 使用自身平台资格。
  - 验收：枚举实际可达 shape 与预捕 key，检查未支持 shape eager、预算不增长、共享 capture failure 不重试；真实 CUDA 比较 replay/eager，HiFT 验证 initial/continuation/final 边界。 ^[PR #8515]

## 决策与踩坑

- [MCPMO-GRAPH-1a] 禁止：用 batch 大小改变显式 TRT 选择；留下多份 stacked attention history；把图的 shape/count 测试当作 padding 后 recurrent cache 已满足数值 parity。fallback Euler 热循环不得每步从 device scalar 取 Python `float`；timeline 的 host step sizes 在循环外准备。
- [MCPMO-GRAPH-1b] 禁止：把固定 query/storage 预留或有限 graph 数量等同总显存上界；将 resident 路径的性能外推到未启用 fused body/slots、其他精度、硬件或 workload。
- [MCPMO-GRAPH-1c] 禁止：为使 tensor 可 stack 而伪造相同 cache 长度；预算耗尽或不支持 shape 时无限递归；把保序 shape smoke 当成真实流式音频质量已验收。
- [MCPMO-GRAPH-1d] 禁止：把历史字符串 `tf32x3` / `3xtf32` 的兼容 alias 宣称为 compensated TF32x3；忽略旧 shipping YAML 键；在 capture 与 replay 间只改开关却宣称 graph 内核精度已变。
- [MCPMO-GRAPH-1e] 禁止：在输入 encoder 的 stateless graphs 与 Code2Wav 的 stateful continuation graphs 之间复用资格或 failure policy；把 fake-capture CPU 测试说成真实 CUDA capture 已通过。
- [MCPMO-GRAPH-1f] 禁止：把 profile enable 说成 API 全局默认；跨 wrapper 复用失败策略；预算已满仍强制预捕 tail，或从 CPU fake graph 测试推出 CUDA parity。
