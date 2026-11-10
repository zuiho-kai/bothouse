---
name: rules-conditioning-handoff
description: "CosyVoice3 conditioning handoff 规则 COSY-PAYLOAD-1a（live conditioning 在 runner replay 后按当前请求重建，保留 speech_token / speech_feat / embedding / speech_token_len，PR #8343）与 COSY-TOKEN-1a（token-only chunk 仍须推进 streaming transfer，processor 声明 requires_token_updates，PR #8473）"
metadata:
  scope: 只收 talker→code2wav 的 conditioning 重建与 token-only 传输两条规则；packed Flow 与 reference cache 归 rules-packed-inference，TensorRT CFM handoff 归 cosyvoice3-rules
---
# CosyVoice3 conditioning handoff 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/cosyvoice3/rules-conditioning-handoff.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8343；PR #8473
- [COSY-PAYLOAD-1a] Live conditioning 必须在 runner replay 后按当前请求重建
  - 触发：修改 talker output、code2wav full-payload adapter、conditioning unwrap 或输出 accumulation policy。
  - 强制：talker forward 统一返回 hidden tensor，两个 runner 在 replay 后附加当前请求 conditioning，不能捕获某次 prefill 的 payload。接受 Mapping（含结构化 payload）；单请求列表/tuple conditioning 必须恰有一项，未拆 batch 明确拒绝。`speech_token`、`speech_feat`、`embedding`、`speech_token_len` 保留非空 tensor 与真实长度；
    - full replacement/REPLACE accumulation 默认在 output module 定义，不能依赖 worker processor import 才生效。
  - 验收：V1/MRv2、eager/replay、混合 prefill/decode、不同宽度 reference、Mapping payload 和单项/多项列表分别覆盖；同请求 conditioning 更新可见且不同请求不能交叉。 ^[PR #8343]
- [COSY-TOKEN-1a] Token-only chunk 必须继续推进 streaming transfer
  - 触发：修改 async CosyVoice talker hidden payload、`requires_token_updates` 或 AR transfer 条件。
  - 强制：async talker 可关闭 pooler hidden payload，code2wav 仍消费 codec IDs 与 conditioning；processor 明确声明 requires_token_updates。即使没有 inter-stage tensor payload，只要有新 token 且 processor 需要更新，或请求停止/结束，就执行 chunk transfer；stage-0-final exclusion 在 free_request 修改 metadata 前计算。
  - 验收：有 token 无 tensor、无 token terminal、普通 tensor 更新、stage-0-final 与另一 hidden-dependent model 分别回归；code2wav 接收的 token 和尾块与优化前一致。 ^[PR #8473]

## 决策与踩坑

- [COSY-PAYLOAD-1a] 禁止：只对普通 dict 保留字段；在 graph 中持有可过期的 prefill conditioning；拼接不同 chunk 的变长 reference；遗漏真实 speech_token_len 或误把多请求列表当单请求。
- [COSY-TOKEN-1a] 禁止：以空 hidden payload 作为跳过所有传输的条件；把 token-only 优化用于仍需要 hidden 的模型；释放 request 后再判断 final-stage 身份而丢失 terminal/update。
