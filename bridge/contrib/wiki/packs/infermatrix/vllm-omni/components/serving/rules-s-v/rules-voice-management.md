---
name: rules-voice-management
description: "规则 SERV-VOICE-1a：/v1/audio/voices delete 按异常类型区分——builtin / default 抛 InvalidPresetVoiceReferenceError 映射 403 ForbiddenError，未知 name 抛 InvalidVoiceReferenceError 映射 404 NotFoundError，uploaded 删除清 metadata 与 speaker artifact cache（PR #7795）"
metadata:
  scope: 只收 voice 删除的错误类型与 HTTP 映射这一条规则；voice 输入与 default 占位（SERV-1g）归 serving-rules-2，voice route 的错误构造不依赖 tokenization handler（SERV-SPEECH-ERROR-1a）归 serving-rules-upstream-compat
---
# Speech voice management 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-voice-management.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7795
- [SERV-VOICE-1a] Voice deletion 必须按异常类型区分 builtin 与不存在
  - 触发：修改 /v1/audio/voices delete、uploaded speaker storage 或错误映射。
  - 强制：在 upload lock 内以规范化name判断，builtin集合排除uploaded项；builtin/default删除抛InvalidPresetVoiceReferenceError，未知name抛InvalidVoiceReferenceError，API先捕preset子类映射403/ForbiddenError，再捕父类映射404/NotFoundError，成功返回明确成功响应。uploaded删除继续清metadata/data-URI/speakerartifactcache，unlink失败保持带voice name的warning。
  - 验收：builtin、default、unknown（含带not found文字的合法name）、uploaded成功与unlink失败分别覆盖route和handler；错误类继承/捕获顺序和case-normalizedname仍正确。 ^[PR #7795]

## 决策与踩坑

- [SERV-VOICE-1a] 禁止：以message substring决定403/404；将builtin当不存在返回404；把async delete恢复为无法表达原因的bool；只在testclient中模拟抛异常而不检查实际HTTPstatus/body。
