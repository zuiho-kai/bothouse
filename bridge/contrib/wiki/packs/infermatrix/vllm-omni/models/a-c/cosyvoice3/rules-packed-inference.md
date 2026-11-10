---
name: rules-packed-inference
description: "CosyVoice3 packed inference 规则（PR #8224）：COSY-PACKED-1a packed Flow 的有效帧、请求顺序与数值边界（仅 CUDA capability major 9 且开关启用）、COSY-PACKED-1b streaming 缓存按请求自有并在终止时释放、COSY-CACHE-1a reference conditioning 按真实音频身份缓存并返回 clone、COSY-SAMPLE-1a RAS 与 standard 采样模式的历史和停止 token 语义"
metadata:
  scope: 只收 packed Flow / HiFT、streaming cache、reference cache 和采样模式四条规则；HiFT decode graph 缓存与自动 profile 归 rules-streaming-graphs，V1 RAS 采样 GPU 化归 cosyvoice3-rules
---
# CosyVoice3 packed inference 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/cosyvoice3/rules-packed-inference.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8224
- [COSY-PACKED-1a] Packed Flow 必须保持有效帧、请求顺序与数值边界
  - 触发：修改 opt-in packed full-response/streaming Flow、ragged prompt packing、batched HiFT 或混合 prefill/decode conditioning。
  - 强制：packed 模式仅在对应开关启用且 CUDA Hopper capability major 为 9 时生效；保留 10-step Euler，Flow 可用 BF16，F0 与 HiFT 保持 FP32。每行先拼 prompt 和 continuation 再右侧 padding；长度分组、finalize 分组后恢复原请求顺序，输出按每行有效长度裁剪。conditioning 按完整 batch 的 request slot 对齐，非 prefill 行保留空位。packed Flow 绕过 Flow TRT，不能据此禁用独立的 speaker TRT。
  - 验收：对未修改的 Flow 参考路径覆盖异长 prompt、batch 大于 8、混合 prefill/decode、full-response/streaming 与 chunk-causal attention；核对有效帧、输出顺序与数值容差，真实 compile/cold-start 另测，不能只靠同实现自比较或 monkeypatch。 ^[PR #8224]
- [COSY-PACKED-1b] Streaming 缓存必须按请求保存自有状态并在终止时释放
  - 触发：修改 packed streaming mel/phase cache、首块直接 finalize、请求完成/取消或 weight-norm folding。
  - 强制：packed streaming 缓存 mel/phase 用 detached GPU clone，普通路径保留 CPU contiguous 状态；首块 full-response shortcut 仅限 packed 模式、所有项 finalize、无既有 cache 且 token offset 为零。完成、取消与错误通过同一锁按 request ID 幂等清理。checkpoint 严格加载后把 HiFT/F0 移到最终设备，再折叠 weight norm 为普通 Parameter；兼容 legacy/modern API 且重复折叠不改变结果。
  - 验收：同 request 的连续块、mixed finalize、重复 cancel/end、空状态与已存在状态分别回归；保留旧状态后推进下一块不得改变旧值，load→move→fold 数值和 state-dict 边界分开验证。 ^[PR #8224]
- [COSY-CACHE-1a] Reference conditioning 必须按真实音频身份缓存并返回独立张量
  - 触发：修改匿名/注册 reference audio 的预处理、speaker artifact cache 或异步预取。
  - 强制：匿名键包含连续 waveform bytes、sample rate、shape、dtype、model directory 与 speaker backend；注册键包含 voice name 和 upload generation。24 kHz conditioning 按 token/feature 最短有效长度对齐。cache 中存 CPU clone，命中也逐字段 clone 返回；reference/target text 单独 tokenize，不混入音频 artifact。
    - 匿名预取先复制输入并复用相同 resampler 与 target sample rate，后续 processor 不重复 resample；注册 voice 不走匿名预取。
  - 验收：同内容复用、同名重上传、采样率/dtype/shape/backend 改变、24 kHz 截齐、命中后原地修改以及预取开关 on/off 均覆盖；conditioning 与未缓存预处理逐字段一致。 ^[PR #8224]
- [COSY-SAMPLE-1a] RAS 与 standard 模式必须保留生成历史和控制 token 语义
  - 触发：修改 `cosyvoice3_sampling_mode`、RAS nucleus/repetition replacement、per-row RNG 或 standard-mode 停止条件。
  - 强制：仅接受 `ras`/`standard`，RAS 是基础默认；RAS nucleus 基于完整分布的 top-p 前缀并受 top-k 上限约束，stable tie 按较小 token ID 排序；重复判定只看已生成历史，不惩罚 prompt。seed/position 对应请求，replacement 使用独立随机流。standard 模式显式选择，并保留整段 200 个 speech-control token 的停止范围。
  - 验收：temperature=0、stable ties、top-p/top-k、generated-only repetition、resume、不同 seed 和混合请求顺序回归；standard/RAS 分别验停止、音频长度与质量，不能只看隐藏状态或短历史 benchmark。 ^[PR #8224]

## 决策与踩坑

- [COSY-PACKED-1a] 禁止：把 reference padding 当有效帧；独立 padding prompt/continuation 留中间空洞；把 grouped 输出按排序顺序发布；沿用旧函数注释声称主线 F0 用 FP64；把 opt-in 变成所有设备默认或宣称 RAS/standard 音质等价。
- [COSY-PACKED-1b] 禁止：对保留历史的后续块再次使用首块捷径；共享可改写 cache view；移设备前折叠造成 CPU/GPU 漂移；把原始 checkpoint 再加载进已折叠实例。原有有界 mel 窗与 phase 合同仍见 `COSYVOICE3-1c`。
- [COSY-CACHE-1a] 禁止：用 URL/文件名代替 waveform 内容身份；复用可被下游修改的 cache tensor；漏掉 generation/backend 或跨模型共享结果；把 process-local 有界 artifact cache 说成预分配显存或全局 RSS 上限。
- [COSY-SAMPLE-1a] 禁止：把 RAS fused 路径扩展到不支持的 top-k 范围；把 resumed generated token 当 prompt 而丢失惩罚状态；用 batch row 代替 request RNG 身份；以吞吐数据证明两种采样分布/质量相同。
