---
name: rules-speech-cache
description: "规则 CONF-SPEECH-1a：顶层 speech_cache 的 resolve_max_bytes、resolve_max_entries、speaker_max_bytes 只接受严格非负 integer（默认 4 GiB、2048、512 MiB，zero 禁用），薄 overlay 递归合并，API-only section 不进 stage args，speaker singleton budget 冲突拒绝（PR #7883）"
metadata:
  scope: 只收 API speech cache 配置一条规则（CONF-SPEECH-1a）；API section 与 stage 字段的核对边界（CONF-3a）归 configuration-rules-3
---
# API speech cache 配置规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-speech-cache.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-06；updated: 2026-10-09
- 来源（sources）：PR #7883
- [CONF-SPEECH-1a] Speech cache budget 必须严格解析并保持 API process 的作用域
  - 触发：修改顶层 speech_cache deploy inheritance、API 初始化或 speaker cache singleton。
  - 强制：仅允许严格非负 integer 的 resolve_max_bytes、resolve_max_entries、speaker_max_bytes；未知字段与非 Mapping 拒绝，config frozen。默认分别 4 GiB、2048、512 MiB；zero 禁用对应 cache。薄 overlay 对 speech_cache 递归合并，显式 zero 保留，其他顶层 scalar 继续替换。此 API-only section 不进入 stage args，按 CONF-3a 的 API section 边界核对最终 deploy 与第一 consumer。
    - API 使用最终选中的 deploy（含模型默认）并记录最终 budget；显式 speaker singleton budget 冲突必须拒绝，首次初始化在 lock 内。
  - 验收：negative/bool/float/unknown/non-Mapping、inheritance+zero、默认 deploy、diffusion/LLM API 初始化、zero storage 与并发 singleton 冲突分别覆盖；检查 entry/bytes eviction，不以 RSS 必须等于 budget 为断言。 ^[PR #7883]

## 决策与踩坑

- [CONF-SPEECH-1a] 禁止：把 bool/string 当 integer budget；替换薄 overlay 时丢掉继承项；恢复旧环境变量作为第二配置接口；把 API waveform/artifact LRU 误认为 stage engine cache、预分配内存或总 RSS/显存上限。
