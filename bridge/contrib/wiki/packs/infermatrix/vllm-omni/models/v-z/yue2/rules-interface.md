---
name: rules-interface
description: YuE2 请求与数值合同：YUE2-INPUT-1a（speech endpoint 的 lyrics/style/ABC 三态、native qwen.tiktoken、25 fps frame budget）与 YUE2-NUMERIC-1a（MoT 权重划分、全曲 FP32 noise、FP32 tiled VAE）
metadata:
  scope: 只收 YUE2-INPUT-1a 与 YUE2-NUMERIC-1a 两条规则；异步 synthesis 的 queue/HOLD/完成确认归 yue2-rules，SheetSage2 转谱到 YuE request 的门禁归 rules-score-handoff
---
# YuE2 请求与数值合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/yue2/rules-interface.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, serving, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7886
- 置信度（confidence）：high
- [YUE2-INPUT-1a] speech endpoint 必须保留 text-to-music 的真实请求语义
  - 触发：修改 `Yue2Adapter.validate/build/apply_sampling_overrides`、native tokenizer、semantic prompt 或 speech 参数透传。
  - 强制：`input` 是非空 lyrics，`instructions` 是非空音乐 style；`cot=off` 不接受 ABC，`melody/full` 必须带非空 `abc`，online v1 不自动生成 ABC。使用 checkpoint-native `qwen.tiktoken` 生成 token-id prompt，并在启动 warmup 解析 tokenizer。`max_new_tokens` 是 25 fps 的 audio-frame budget，须满足 preset 上下限和 prefix+frames 的 context bound；
    - engine 的 `max_tokens` 多留一个 finishing step。完整 prefix ids 随 request extras 传入 NAR conditioning，不能从 prefix-cache hit 后的 uncached tail 重建。显式 seed 保留，缺 seed 时每个请求独立抽取；phase sampling preset 和 stop ids 由模型固定。
  - 验收：覆盖缺 lyrics/style、ABC 三态、unsupported speech fields、frame/context 两层 budget、prefix-cache hit 和有/无 seed；最后一帧后仍能交付 finishing 音频，输出为 48 kHz stereo。^[PR #7886]
- [YUE2-NUMERIC-1a] MoT 权重、whole-song noise 和 FP32 VAE 必须保持各自边界
  - 触发：修改 `partition_checkpoint_weights/load_weights`、`song_chunks`、NAR solve 或 tiled VAE decode。
  - 强制：单一 checkpoint 中 AR tensors 交给 backbone loader，NAR/projection tensors 按模型命名映射并检查 missing/unexpected，同时将手工加载 keys 纳入 loader 的 loaded set；deterministic latent position table 重建。按 request seed 在 CPU 一次生成全曲 FP32 noise，再沿 chunk boundaries 切片；每个 NAR chunk 在 `finally` 关闭 cached engine。
    - VAE 在启动加载、纳入实际内存 profiling，decoder 保持 FP32 并关闭 autocast；terminal decode 使用 1024-frame core、16-frame halo，检查 finite 输出并保持 channels-first stereo。
  - 验收：验证 AR/side namespace、缺权重失败和 loaded-key accounting；相同 seed 的全曲 noise 与 chunk 拼接一致；FP32 full/tiled decode 核对边界、长度、finite 值和 stereo layout。异步 synthesis 的 queue/HOLD/完成确认另遵循 [[yue2-rules]]（synthesis rules）。^[PR #7886]

## 决策与踩坑

- [YUE2-INPUT-1a] 禁止：接受 streaming、reference audio/text、language/task_type、非 default voice、非 1.0 speed 或用户覆盖 fixed sampling，却默默忽略；将 `max_tokens` 恰好卡在最后一帧；在 driver 路径使用普通 HF 文本 tokenizer 替代 native BPE。
- [YUE2-NUMERIC-1a] 禁止：每个 chunk 重新 seed/抽 noise；将 VAE 注册进 AR checkpoint module tree而被全模型 dtype 转换或权重覆盖；把 AR BF16 policy 应用于 VAE；将 tiled decode 的边界正确性或一次模型观测推广为通用质量/性能保证。
