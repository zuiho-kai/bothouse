---
name: rules-registered-reference
description: "MOSS 注册 reference：MOSS-REF-1d 注册 voice 须绑定不可变 generation 与 name/created_at/file_path/ref_text snapshot，cold resolver 校验上传目录与 generation，prefix-cache salt 用已验证 name/generation 替代主 ref_audio（含 Nano）（PR #7883）"
metadata:
  scope: 只收 MOSS-REF-1d 一条规则；reference encoder 缓存与 slot identity 归 moss-tts-rules-2，共享 reference worker 归 rules-local-streaming
---
# MOSS 注册 reference 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/moss-tts/rules-registered-reference.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-06；updated: 2026-10-09
- 来源（sources）：PR #7883
- [MOSS-REF-1d] 注册 voice 必须绑定不可变 generation 并保留 conditioning 身份
  - 触发：修改注册 MOSS voice 的 reference binding、cold resolver 或 prefix-cache salt。
  - 强制：非 Nano 变体仅在服务端验证已上传 voice、generation>0 且没有 inline audio override 时，绑定 name/created_at/file_path/ref_text snapshot；blank ref_text 才填默认。cold resolver 在线程中校验路径仍在 uploaded directory、文件 generation 匹配，保留原 WAV PCM16→float32/channel-mixing 处理。缺失/删除 generation 失败，不能换用同名新上传。
    - 内部 registered key 不交给普通 URI resolver，解析后移除临时 primary key；对无 inline override 且服务端 generation>0 的注册 voice，所有 MOSS 变体（含 Nano）的 salt 都以已验证 name/generation 替代主 ref_audio，继续包含第二 reference 与其余 conditioning。Nano 仍先走既有 uploaded-speaker waveform 路径，再把服务端 identity 传给 conditioning_cache_salt；
    - 该 identity 不要求 Nano 使用新 snapshot/cold-loader 路径。
  - 验收：hot/cold、re-upload、delete、generation/file mismatch、inline override、ref_text 和第二 reference 变化分别覆盖；cold 音频与旧 resolver 一致，上传数据无需驻留 data URI，旧 MOSS 内容/任务 salt 合同仍保持。另验证 Nano 的有效注册 identity 参与 salt 而保留 waveform 路径；
    - Local 的 primary reference code-cache 热命中不 resolve waveform，不能推广为所有变体或第二 reference 都免 resolve。 ^[PR #7883]

## 决策与踩坑

- [MOSS-REF-1d] 禁止：信任客户端给出的 registered tuple/path；热命中/冷 miss 产生不同 salt；复用旧 generation cache；改变 Nano 的既有 waveform 路径或为省序列化改变音频量化。
