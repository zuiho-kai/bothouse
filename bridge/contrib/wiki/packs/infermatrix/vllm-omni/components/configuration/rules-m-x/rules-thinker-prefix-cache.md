---
name: rules-thinker-prefix-cache
description: 规则 VLLM-OMNI-PR9203-THINKER-PREFIX-CACHE：stage-0 Thinker 的 enable_prefix_caching 默认开启仅限 qwen3_omni_moe.yaml 与 minicpmo_4_5_turn.yaml 的 CUDA turn profile，MRv2、duplex、base 与非 CUDA overlay 为 false，按 merge_pipeline_deploy 合并后的最终值经 test_thinker_prefix_cache_defaults 验收
metadata:
  scope: "只收 PR #9203 的 Thinker prefix cache deploy 默认值一条规则；dots.tts 的 enable_prefix_caching pin（CONF-3c）归 configuration-rules-3"
---
# Thinker prefix cache deploy 默认值

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-thinker-prefix-cache.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #9203
- [VLLM-OMNI-PR9203-THINKER-PREFIX-CACHE] Thinker prefix cache 默认开启仅限已验证的 CUDA turn profile
  - 触发：修改 Qwen3-Omni / MiniCPM-o 家族 deploy YAML 中 stage-0（Thinker）的 `enable_prefix_caching`，或经 `base_config` / platform overlay 派生 turn、MRv2、duplex profile 时核对继承后的最终值。
  - 强制：默认开启只允许已验证的 V1 CUDA turn serving profile——`qwen3_omni_moe.yaml` stage 0 与 `minicpmo_4_5_turn.yaml` stage 0（仅 CUDA）为 `true`。
    - 本 PR 显式设回 `false` 的是 `qwen3_omni_moe_mrv2.yaml`、`qwen3_omni_duplex.yaml`、`minicpmo_4_5_turn_mrv2.yaml` 与 base `minicpmo_4_5.yaml`，并由 `minicpmo_4_5_turn.yaml` 的 rocm/xpu/musa overlay 关闭非 CUDA 平台；
    - MRv2 尚不合并 cached Thinker rows（MiniCPM-o MRv2 在 stage-0 hit 下 79/80 请求失败），duplex 的 KV window 拒绝该 cache。
    - 矩阵中的 `qwen3_omni_duplex_mrv2.yaml`、`minicpmo_4_5_turn_mrv2_h200.yaml`、`minicpmo_4_5_duplex_h200.yaml` 仅以合并后最终值断言为 `false`，diff 未显示显式改动——改 base 默认值时必须逐一审计 `base_config` 继承链与 platform overlay，不得假设派生 profile 不受影响。stage 值经 `engine_extras` 传递，须压过 pipeline 级 flag。
    - 默认 on 依赖 #9162（并发 hit collapse 修复）与 #9193（0% hit per-step 开销修复）已合入，提案须附 0% hit 开销上限与输出行为等价证据。
  - 验收：`test_thinker_prefix_cache_defaults` 在最终 `stage0.yaml_engine_args["enable_prefix_caching"]` 上断言实际参数化的行：两个 CUDA turn profile 为 `True`；这两个 profile 在 npu/rocm/xpu/musa 下为 `False`；CUDA 下所列 MRv2 / duplex / base profile 行为 `False`（非 CUDA 平台仅对这两个 turn profile 有覆盖，新增其它 profile×platform 组合须自行补参数行）。
    - 测试须 pin `platforms.current_omni_platform.device_name` 并走 `_apply_platform_overrides` + `merge_pipeline_deploy`；e2e 断言 Thinker 开、Talker/Code2Wav 保持关，并附 batch-invariant（46/46）、Daily-Omni（0.7157 vs 0.7157）、Seed-TTS WER（0.0207 vs 0.0215）等行为等价证据；
    - 文档（`docs/serving/video_stream_api.md`）与新默认值同步。^[PR #9203]

## 决策与踩坑

- [VLLM-OMNI-PR9203-THINKER-PREFIX-CACHE] 禁止：把 base 的默认 on 推广到 MRv2 / duplex / NPU 等未验证组合；只读原始 YAML 值而不核对 `merge_pipeline_deploy` 合并后的最终 engine args；在缺少前置修复的分支上宣称默认开启安全（仅 main 上 Qwen3-Omni 长 shared prefix C64 collapse −68%~−77%，MiniCPM-o decode −19%）；让矩阵测试结果依赖运行机器的 host platform。
