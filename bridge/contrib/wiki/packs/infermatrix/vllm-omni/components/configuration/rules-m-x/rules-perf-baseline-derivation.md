---
name: rules-perf-baseline-derivation
description: 规则 VLLM-OMNI-PR8720-PERF-BASELINES：tests/dfx/perf/tests/ 性能基准 JSON 扩并发档位（C16/C32）时既有 H100/A3/A2 参考原样保留，新档位取历史硬件测量并引用 Buildkite build 与 commit，吞吐 × 0.90、延迟与 audio RTF × 1.10，未测量硬件（B200）删除占位 baseline
metadata:
  scope: "只收 PR #8720 的性能基线扩档与推导一条规则（MiniCPM-o 4.5 chat 与 duplex seed-tts 基准 JSON）；不含 benchmark 执行步骤与证据口径"
---
# 性能基准扩档与基线推导规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-perf-baseline-derivation.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-10-14；updated: 2026-10-14
- 来源（sources）：PR #8720
- [VLLM-OMNI-PR8720-PERF-BASELINES] 扩并发性能基线必须保留既有参考并按正确余量方向推导
  - 触发：修改 `tests/dfx/perf/tests/` 下的性能基准 JSON（如 `test_minicpmo_4_5.json`、`test_minicpmo_4_5_duplex_seed_tts.json`）：新增并发档位（C16/C32）或 prompt 规模、为某硬件派生 baseline 数值、启用 `seed_tts_wer_eval` 或调整 duplex sweep。
  - 强制：扩档不得触碰既有参考——未重算的 H100/A3 chat C1/C4/C8 与 A2 原档位必须原样保留，即使单次历史跑值与参考不一致也不得借机放宽，回归另行调查。新档位参考只能取真实历史硬件测量，并在 JSON `description` 中引用 Buildkite build 与 commit SHA，注明这是历史参考测量、非当前 head 验证；余量方向固定：吞吐 × 0.90、延迟与 audio RTF × 1.10，四舍五入到 4 位小数。未测量硬件（本例 B200）必须删除占位 baseline 桶但保留 workload 执行；
    - runner 的 `assert_result` 独立强制全部请求完成与每 duplex session 四个音频 turn、不数值断言性能基线——基线缺失或宽松不得削弱完成性检查。WER 在固定数据集与 ASR 下重复测量出校准阈值之前只是采集，不构成质量门槛。
  - 验收：逐硬件断言既有档位数值与父配置逐位一致；新增档位每个数值可由 cited build 测量按 ×0.90/×1.10 与 4 位舍入复算；未测量硬件无 baseline 字段但仍在 sweep 中执行；duplex 的请求数与每 session 四个音频 turn 由 `assert_result` 独立断言，不依赖 baseline。^[PR #8720]

## 决策与踩坑

- [VLLM-OMNI-PR8720-PERF-BASELINES] 禁止：扩档时顺手重算或放宽既有基线；把吞吐余量方向写反（× 1.10，本次已修正）；保留无测量依据的占位 baseline；以历史 build 绿灯冒充当前 head 的 serving 验证；宣称启用 WER 评估即建立质量阈值，或用基线数值校验代替请求完成性断言。
