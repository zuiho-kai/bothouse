---
name: rules-streaming-graphs
description: "CosyVoice3 bounded HiFT graph 规则：COSY-GRAPH-1a HiFTDecodeGraphs 缓存有界（seen LRU 128、graph 32，同 signature 第三次才 capture）并返回 clone（PR #8420），COSY-PROFILE-1a 自动 profile 仅在 NVIDIA CUDA capability major 恰为 9、显存至少 140 GiB 且 MPS control 存在时选 optimized standard（PR #8433）"
metadata:
  scope: 只收 HiFT decode graph 缓存与 pipeline profile 自动选择两条规则；packed Flow 与 streaming mel/phase cache 归 rules-packed-inference，F0 device 归 rules-f0-device
---
# CosyVoice3 bounded HiFT graph 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/cosyvoice3/rules-streaming-graphs.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8420；PR #8433
- [COSY-GRAPH-1a] HiFT graph 缓存必须有界并返回自有结果
  - 触发：修改 `HiFTDecodeGraphs`、packed DiT attention 的 query span 或 graph/cached-iSTFT 开关。
  - 强制：CPU、nested capture 和未满足缓存条件的调用走 eager；signature 包含 mel/source shape、device、两者 dtype、finalize、TF32 与 autocast precision 状态。seen LRU 上限 128，graph 上限 32，同 signature 第三次出现才 warm/capture；warm stream 依赖调用者 stream，replay 后返回 clone。F0、noise、phase 与请求状态留在 deterministic decode graph 外。
    - streaming DiT query bound 用 static chunk size，full response 用 page-table span；不能以完整 KV prefix 代替 query span。启用 decode graphs 会同时启用 cached iSTFT。
  - 验收：首两次 eager、第三次 capture、复用、32/128 边界、CPU/nested capture、precision 与 finalize 变更分别覆盖；旧返回值在下一次 replay 后保持不变，graph/eager 数值及首次编译失败语义单独验证。 ^[PR #8420]
- [COSY-PROFILE-1a] 自动 profile 只能在完整设备能力检查通过后选择
  - 触发：修改 CosyVoice3 pipeline resolver、packed streaming deploy 或 offline example sampling budget。
  - 强制：resolver 仅识别 CosyVoice3 HF config；通过 platform/NVML 查询、不初始化父进程 CUDA。只有 NVIDIA CUDA、capability major 恰为 9、显存至少 140 GiB 且 MPS control 可执行存在，才选 optimized standard profile；否则 generic，保留显式 deploy/CLI 优先级。optimized profile 自带 stage-0 standard HF override；stop tokens 包含全部 200 个 speech controls。
    - example 根据最终 stage-0 config 取模式并复制默认 sampling，把 min_tokens 限制在有效 max_tokens 内。
  - 验收：mock 不同 capability/memory/MPS availability、wrong model type、显式 override 与严格 token budget；验证父进程未 init CUDA、低预算不会因 min_tokens 超预算停滞，并分别报告 cold/warm latency 与音频长度/质量。 ^[PR #8433]

## 决策与踩坑

- [COSY-GRAPH-1a] 禁止：把 capture output view 当持久请求输出；忽略 precision/finalize 导致错图；无限增长缓存；把 eligibility/capacity 的 eager 回退描述为 capture 异常恢复——此实现的 capture 异常会传播，不能宣称已自动 disable/retry。
- [COSY-PROFILE-1a] 禁止：只按 GPU 名称或 `major>=9` 推断 eligibility；选择 profile 后忽略显式 override；把标准采样标成 RAS 等价；把 graph pool 算作 gpu_memory_utilization 内的全部内存，或把第三次 lazy capture 的耗时隐去。
