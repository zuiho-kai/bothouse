---
name: qwen-omni-rules-mrv2-audio
description: "Qwen3-Omni MRv2 audio handoff 规则：QOMNI-MRV2-1a sampled embedding 与 codec frame 对应当前 request 的有效 sample、QOMNI-MRV2-1b Talker first audio 的一帧显式配置、QOMNI-MRV2-1c residual-codebook predictor 与 length-grouped decoder 的 opt-in 和逐 row trim（PR #8223）"
metadata:
  scope: 只收 QOMNI-MRV2-1a / 1b / 1c；混合长度 crop 的 QOMNI-1h3 归 qwen-omni-rules，layer-0 capture 归 rules-embedding-capture
---
# Qwen3-Omni MRv2 audio handoff 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-omni/rules-mrv2-audio.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8223
- 置信度（confidence）：high
- [QOMNI-MRV2-1a] sampled embedding 和 codec frame 必须对应当前 request 的有效 sample
  - 触发：修改 Thinker→Talker early handoff、sampled embeddings、MTP eager frames 或 Talker→Code2Wav payload。
  - 强制：只有 staged Thinker 且无 speculative config 时发布 early sampled embedding；speculative 路径保留原 capture-stream handoff。完成 prefill 的 sample 可补齐 Talker prompt 的首 generated-token embedding；随后按 sampled-text-stream 状态发送每步新 sample。
    - partial/resumed prefill 显式发布 empty sample marker，保留 mode 并跳过已经发过的 capture text；非终态 decode 缺 sample 应失败。MRv2 eager MTP 以 token-major codes 最后一 row 和显式 frame-valid 决定是否 append，该 row 必须 clone 拥有 storage；V1/deferred frame 仍保留 zero-placeholder/stop-token 分支。
    - codec vocabulary 和 quantizer 数从模型 config 读取。
  - 验收：覆盖首 prefill sample、全 batch partial prefill、preemption resume、缺 sample、EOS 和 V1/deferred 对照；batch reorder 后每 request codes/embeddings 保持对应，下一次 replay 不覆盖已提交 payload。^[PR #8223]
- [QOMNI-MRV2-1b] Talker first audio 只在一帧无上下文的显式配置下启用
  - 触发：修改 `talker_first_audio_enabled`、first-frame decoder、chunk ramp 或 first-audio trimming。
  - 强制：要求 connector `talker_first_audio=true`、initial chunk 恰好一 frame、环境开关允许、CUDA MRv2 async-chunk、本地 TP=PP=1、local executor 且 prefix cache 关闭。Talker copy 与 Code2Wav 使用同 class/config/dtype/device；side-stream first-frame graph 每 bucket 独立 pool，输出必须 copy 为新 FP32 tensor。
    - 只在第一 codec chunk 携带 first-audio marker，并由最终音频路径裁掉 Code2Wav 对该 prefix 的重复样本；其他 chunks 继续按 ramp、steady size 和左上下文发送。
  - 验收：逐项关闭 eligibility 后回到 regular codec path；核对 singleton/batched first-frame prefix 和 owned output，marker 只到 chunk 0；首帧音频加 trimmed 后续 chunks 与固定 decoder reference 核对时序/长度/容差。^[PR #8223]
- [QOMNI-MRV2-1c] predictor 与 length-grouped decoder 优化必须保留 opt-in 和逐 row trim
  - 触发：修改 residual-codebook predictor sampling、incremental/short-KV、Code2Wav length grouping、fused Snake 或 cuDNN warmup。
  - 强制：deploy 的 `subtalker_sampling_params` 写入 predictor 的 stored top-k/top-p/do_sample 设置；不可假设 per-call参数会覆盖 stored sampler。incremental KV 使用显式 connector opt-in 和平台编译能力；fp16 或不支持 Inductor 时保留 re-prefill，short-KV 还须显式请求、CUDA BF16。
    - decoder grouping 根据实际 lengths、graph buckets 和 captured row counts 规划，恢复原 row 顺序；crop 仍以本 group decoded window 的真实 tail 与每 row 的 left context/有效 frames 计算，遵循 [[qwen-omni-rules]]（mixed-length trim rule）。fused Snake 仅在显式 CUDA opt-in 下替换；
    - cuDNN benchmark 仅在 eager warmup/非 capture 生效并通过 context 恢复进程 settings。
  - 验收：覆盖 stored sampling/greedy、fp16与平台 fallback、short/steady mixed lengths、bucket miss 与 row reorder；分别核对裁剪样本、settings在异常后恢复，以及固定 input/seed 下优化路径的真实数值与 replay证据。^[PR #8223]

## 决策与踩坑

- [QOMNI-MRV2-1a] 禁止：用 speculative 变宽 sample 套用单 token early handoff；把 empty marker 当成丢失 output 或重新发送 prefill text；将 graph-owned batch output 的 view 留给下一步；把 EOS/special CB0 作为有效 codec frame。
- [QOMNI-MRV2-1b] 禁止：以通用 capability guard 代替模型 opt-in；将多帧、有历史上下文、跨 rank 或 prefix replay 视为同一首帧路径；让两个 process 的可选 cuDNN autotune 推导出 bitwise PCM 保证；第一音频和 Code2Wav copy 重复输出。
- [QOMNI-MRV2-1c] 禁止：把 group padding 当作短 row 有效未来 context；取消平台/dtype fallback；在 capture 内做算法搜索；用 historical concurrent benchmark 或单个 kernel A/B 宣称 speech-quality parity、普遍吞吐或 latency 保证。
