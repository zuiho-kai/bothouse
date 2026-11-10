---
name: inspect-existing-tests-first-2
description: 规则“先看现有代码，再谈方案”（2/2）：2026-06-04 HunyuanImage3 Stage 0 mm_encoder_attn_backend=TORCH_SDPA 精度复跑的口径、四层证据、stage devices、cleanup 误杀与结果
metadata:
  scope: 只收 2026-06-04 HunyuanImage3 Stage 0 TORCH_SDPA 精度复跑记录和源页“相关”；原则、判据模板和 2026-06-02 运行记录归 inspect-existing-tests-first-1
---
# 规则：先看现有代码，再谈方案（2/2）

## 现状

- 源页拆为两页：[[inspect-existing-tests-first-1]] 收反面教训、原则、文件清单、判据模板和 2026-06-02 的现成 IT2I accuracy pytest 记录；
  本页收 2026-06-04 Stage 0 `mm_encoder_attn_backend=TORCH_SDPA` 精度复跑和“相关”。

## 关键事实

- 源页：`knowledge/general/ci/guides/inspect-existing-tests-first.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, ci；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：`#3297`、`tests/e2e/accuracy/test_hunyuan_image3.py`、`tests/e2e/accuracy/conftest.py`

### HunyuanImage3 Stage 0 `mm_encoder_attn_backend=TORCH_SDPA` 精度复跑（2026-06-04）

- 用户要求只在第 0 阶段重跑 `mm_encoder_attn_backend: TORCH_SDPA`，并打印字段确认生效。仍然复用同一条现有 pytest：

```bash
tests/e2e/accuracy/test_hunyuan_image3.py::test_image_to_image_alignment
```

- 本轮有效口径：

```bash
cd <REMOTE_WORK_ROOT>/wt-pr3297-accuracy
export CUDA_VISIBLE_DEVICES=2,3,5,6
export HUNYUAN_AR_DEVICES=5,6
export HUNYUAN_DIT_DEVICES=2,3
export STAGE0_MM_ENCODER_ATTN_BACKEND=TORCH_SDPA
export VLLM_USE_FLASHINFER_MOE_FP16=0
export HF_HOME=/data/model
unset TRANSFORMERS_CACHE HF_HUB_CACHE
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export HUNYUAN_MODEL_PATH=/data/model/hub/models--tencent--HunyuanImage-3.0-Instruct/snapshots/2ec2c78bee7d4b94157341fba86c4c2c7b1858b2
export PYTHONPATH=<REMOTE_WORK_ROOT>/pydeps-pr3297-accuracy:<REMOTE_WORK_ROOT>/wt-pr3297-accuracy:${PYTHONPATH:-}
export TMPDIR=/tmp
```

- 必须打印四层证据：

```text
CONFIG_CHECK generated_yaml.stage0.mm_encoder_attn_backend=TORCH_SDPA
CONFIG_CHECK filtered_engine_args.stage0.mm_encoder_attn_backend=TORCH_SDPA
CONFIG_CHECK vllm_config.stage0.model_config.multimodal_config.mm_encoder_attn_backend=TORCH_SDPA
Using AttentionBackendEnum.TORCH_SDPA for MMEncoderAttention.
```

- 非连续 GPU 可见集要显式写 stage devices。解决方式是生成 YAML 时同时打印并设置：

```text
CONFIG_CHECK generated_yaml.stage0.devices=5,6
CONFIG_CHECK generated_yaml.stage1.devices=2,3
```

- 2026-06-04 跑 PR #3297（head `5b5a4b3850edf88cd84499ff3afbd23874d43a6f`）Stage 0 SDPA 结果目录：

```text
<REMOTE_WORK_ROOT>/pr3297_accuracy_stage0_mm_sdpa_patch3_20260604_113531
```

- 结果：

| Metric | Value | L20x Reference |
|---|---:|---:|
| COT similarity to reference | 0.9697 | 0.9644 |
| COT prefix match | 37 | 29 |
| Image-Image similarity | 92.6552 | 94.5538 |
| SSIM | 0.2371 | 0.2420 |
| PSNR (dB) | 14.02 | 14.10 |

- pytest summary: `1 passed, 19 warnings in 449.44s (0:07:29)`. 临时 patch 已恢复，`post_restore.diff` 为 0 字节。

### 相关

- 精度/性能结论开跑前先固定证据合同：[[benchmark-contract]]（benchmark contract）。

## 决策与踩坑

- （配置注入）不要用 wrapper import test module 后 monkeypatch `_DEPLOY_CONFIG`：pytest 会重新 import 模块，容易出现 wrapper 看到 `TORCH_SDPA`、真实 pytest 没吃到配置的假阳性。
- （配置注入）更稳的是对远端 worktree 做临时 on-disk patch，备份原文件，`trap` 里恢复，并在结束后保存 `post_restore.diff`。
- （stage devices）`CUDA_VISIBLE_DEVICES=2,3,5,6` 时，如果只靠默认 Stage 0 `0,1` / Stage 1 `2,3`，Stage 1 会把 `2,3` 当物理卡使用，而 Stage 0 的 `0,1` 也可能 remap 到物理 `2,3`，导致两个 stage 抢同一组卡。
- （cleanup）现有 pytest 的 cleanup 会全局扫描并终止 `vllm` 进程，本轮实际扫到并杀了旧 PID `3657851` / `3659955`。
- （cleanup）下次在共享节点复跑前，必须先 patch/override cleanup，只清理本轮 runner 进程组或 `/proc/<pid>/cwd` 属于本次 worktree 的进程；不能让测试自己的 cleanup 误杀其他人的 `vllm` 任务。
