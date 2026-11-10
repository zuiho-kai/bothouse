---
name: rules-realtime
description: "Qwen3-Omni 规则 QOMNI-2a：旧 Qwen Realtime truncate 的约 383 ms/token 前缀只作近似对齐，token 数四舍五入并限制在已生成 IDs 范围，通用 handler 已改用实际 duration/token prefix（PR #7285、PR #8339）"
metadata:
  scope: 只收 QOMNI-2a 一条规则；通用 Realtime route、PCM 与 history 生命周期归 rules-realtime-openai，Thinker/Talker 与 stage transfer 归 qwen-omni-rules
---
# Qwen3-Omni Realtime 音频 history 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-omni/rules-realtime.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, qwen-omni；created: 2026-10-06；updated: 2026-10-09
- 来源（sources）：PR #7285；PR #8339
- 置信度（confidence）：high
- [QOMNI-2a] Realtime truncate 的 Qwen token 前缀只能作为近似对齐
  - 触发：修改仍保留 `_qwen3_omni_truncate_transcript` 的旧 Qwen3-Omni Realtime 实现。
  - 强制：该旧实现约 383 ms/token 的换算仅用于 Qwen path；token count 四舍五入并限制在已生成 IDs 的区间，缺 token IDs 返回空前缀。只有音频长度与 content_index 合法时才改 history；共享会话存储、deferred event 与 terminal response 归 serving owner。
  - 验收：保留旧实现的 checkout 检查 0 ms、半 token rounding、超出 IDs 的 clamp、空 IDs 与合法 truncate；通用 chat-backed handler 已移除该固定 ratio，改验实际 duration/token prefix，合同归 [[rules-realtime-openai]]（SERV-RT-1i；源锚点 #serv-rt-1i-通用音频输出与-transcript-truncate-必须使用实际输出时长）。精确字幕/词级对齐需要独立真实音频证据，不能由这两种近似推导。^[PR #7285] ^[PR #8339]
  - 完整 route、PCM 与 history 生命周期见 [[rules-realtime-openai]]（OpenAI Realtime 规则）；Thinker/Talker 与 stage transfer 见 [[qwen-omni-rules]]（Qwen-Omni 规则）。

## 决策与踩坑

- [QOMNI-2a] 禁止：把固定 token/ms 当作逐 token 强制对齐或精确词级时间戳；将 Qwen ratio 放进 generic session，使其他模型或 native duplex 继承；把播放确认扩展当作 OpenAI 标准必需输入。
