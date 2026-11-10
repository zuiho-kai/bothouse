---
name: inspect-existing-tests-first-1
description: 规则“先看现有代码，再谈方案”（1/2）：2026-04-21 反面教训、原则、vllm-omni 精度 CI 文件清单、判据模板、HunyuanImage3 现成 IT2I accuracy pytest 与 2026-06-02 结果
metadata:
  scope: 只收“新增方案或测试前先确认已有代码和覆盖”的原则、判据和 2026-06-02 HunyuanImage3 IT2I accuracy 运行记录；2026-06-04 Stage 0 TORCH_SDPA 复跑归 inspect-existing-tests-first-2
---
# 规则：先看现有代码，再谈方案（1/2）

## 现状

- 源页拆为两页：本页收反面教训、原则、文件清单、判据模板和 2026-06-02 的现成 IT2I accuracy pytest 记录；
  [[inspect-existing-tests-first-2]] 收 2026-06-04 Stage 0 `mm_encoder_attn_backend=TORCH_SDPA` 精度复跑和“相关”。

## 关键事实

- 源页：`knowledge/general/ci/guides/inspect-existing-tests-first.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, ci；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：`#3297`、`tests/e2e/accuracy/test_hunyuan_image3.py`、`tests/e2e/accuracy/conftest.py`

### 原则

- **"团队同款 CI / 同款测试 / 同款 pattern"类需求，第一件事**：
  1. 打开 `tests/` 目录看文件名
  2. 找**语义最接近**的现有测试（model 换一下就能复用的）
  3. 读它的 conftest fixture、CLI option、运行方式
  4. **考虑能不能直接复用 / 复制一份改名**
- **把这 3 步做完再开始讨论方案**。不做这 3 步的方案讨论都是空想，容易导致：
  - 重复造轮子
  - 引入团队没用过的依赖（reviewer 不信任）
  - 方案复杂度远高于必要

### 具体到 vllm-omni 精度 CI 的文件清单（2026-04-21 查证）

| 目录 | 内容 |
|---|---|
| `tests/e2e/accuracy/` | 所有精度 CI 入口 |
| `tests/e2e/accuracy/conftest.py` | 当前仍存在的 Wan2.2/HunyuanVideo accuracy fixtures 和 CLI options |
| `tests/e2e/accuracy/test_hunyuan_image3.py` | HunyuanImage3 IT2I/COT 对齐入口 |
| `tests/e2e/accuracy/test_hunyuan_image3_pixel_accuracy.py` | HunyuanImage3 像素精度入口 |
| `tests/e2e/accuracy/helpers.py` | `reset_artifact_dir` 等 |

### 下一次做新模型精度 CI

- 先从当前 `tests/e2e/accuracy/` 选择语义最接近的幸存者，读取它的 fixture、CLI 选项和运行方式，再决定复用还是新增；不要假设历史 GEBench 文件或参数仍存在。

### 判据模板

- 用户问"做 XX 精度 CI"时，先回答 3 个问题再提方案：
  1. 团队现有类似测试文件？叫什么名字？
  2. 它的 fixture 和 CLI option 我的模型能复用吗？
  3. 跑一下当前幸存者的最小 pytest 入口会发生什么？只有现行路径的采集或运行错误才说明需要改，不要为已删除的 slug 重建测试文件。

### HunyuanImage3 现成 IT2I accuracy pytest（2026-06-02）

- 用户要跑 Hunyuan PR 分支精度时，不要重新找 benchmark runner。仓库已经有现成入口：

```bash
tests/e2e/accuracy/test_hunyuan_image3.py::test_image_to_image_alignment
```

- 这条 pytest 会跑 HunyuanImage3 image-to-image alignment，并直接打印 COT / image similarity / SSIM / PSNR 表。
- 在 B3 `root@<REMOTE_HOST> -p 31449` 上跑 PR 分支的可复用环境：

```bash
cd <REMOTE_WORK_ROOT>/wt-pr3297-accuracy
export CUDA_VISIBLE_DEVICES=4,5,6,7   # 换成当前空闲的 4 张物理卡
export VLLM_USE_FLASHINFER_MOE_FP16=0
export HF_HOME=/data/model
unset TRANSFORMERS_CACHE HF_HUB_CACHE
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export HUNYUAN_MODEL_PATH=/data/model/hub/models--tencent--HunyuanImage-3.0-Instruct/snapshots/2ec2c78bee7d4b94157341fba86c4c2c7b1858b2
export PYTHONPATH=<REMOTE_WORK_ROOT>/pydeps-pr3297-accuracy:<REMOTE_WORK_ROOT>/wt-pr3297-accuracy:${PYTHONPATH:-}
export TMPDIR=/tmp

<REMOTE_WORK_ROOT>/.venv/bin/python3 -m pytest -s -v \
  tests/e2e/accuracy/test_hunyuan_image3.py::test_image_to_image_alignment \
  --tb=short
```

- 运行前要做硬 gate：选中的 4 张物理 GPU 都低于 5 GiB，并连续检查几轮。
- 这个测试里 Stage 0 AR 用可见卡里的逻辑 `0,1`，Stage 1 DiT 用逻辑 `2,3`；例如 `CUDA_VISIBLE_DEVICES=4,5,6,7` 时，AR 落物理 4/5，DiT 落物理 6/7。
- 共享节点会在 gate 之后仍被其他任务抢占，失败时先用 `/proc/<pid>/cwd` 确认进程归属，只清理本次 `<REMOTE_WORK_ROOT>/wt-pr3297-accuracy` 进程组，不能误杀其他人的 `<REMOTE_WORK_ROOT>` 或 `<REMOTE_WORK_ROOT>` 任务。
- 2026-06-02 跑 PR #3297（head `5b5a4b3850edf88cd84499ff3afbd23874d43a6f`）的有效结果目录：

```text
<REMOTE_WORK_ROOT>/pr3297_accuracy_v21_no_fi_gate6_20260602_193332
```

- 结果：

| Metric | Value | L20x Reference |
|---|---:|---:|
| COT similarity to reference | 0.9722 | 0.9644 |
| COT prefix match | 29 | 29 |
| Image-Image similarity | 92.5253 | 94.5538 |
| SSIM | 0.2379 | 0.2420 |
| PSNR (dB) | 13.73 | 14.10 |

- pytest summary: `1 passed, 19 warnings in 494.51s (0:08:14)`.

## 决策与踩坑

### 反面教训（2026-04-21）

- 做 HunyuanImage-3 精度 CI 时，我绕了一大圈：
  - 提议 GenEval + mmdet → mmcv 在 Py3.12 装不上 → 建独立 venv → 讨论怎么接 buildkite
  - 讨论"用 CLIP-score 替代"、"改 GenBench 砍 it2i"、"采集 9 小时 baseline"
  - 写了 300 行方案对比文档
- 结果用户直接去看当前 target 的 `tests/e2e/accuracy/`：旧记录中的 `test_gebench_h100_smoke.py` 和 `test_gedit_bench_h100_smoke.py` 已经删除；
  当前 HunyuanImage3 的入口是 `tests/e2e/accuracy/test_hunyuan_image3.py`，并由 `tests/e2e/accuracy/conftest.py` 提供仍然存在的 accuracy fixtures。
- 旧的 `--gebench-model` 路径不能再当作现行合同。
- 我前面所有工作（踩 mmcv 坑、建 Py3.10 venv、写 GenEval 集成代码）全部白做。

### 踩坑记录（HunyuanImage3 现成 IT2I accuracy pytest，2026-06-02）

- `<REMOTE_WORK_ROOT>/.venv` 的 vLLM 0.22 会和 PR #3297 代码 ABI 不匹配，报 `split_routed_experts` import error；用 `<REMOTE_WORK_ROOT>/.venv/bin/python3`（vLLM 0.21.0）。
- target deps 放 `<REMOTE_WORK_ROOT>/pydeps-pr3297-accuracy`，至少需要 `FlagEmbedding`、`datasets`、`torchmetrics`；避免覆盖 venv 自带的 `numpy` / `huggingface_hub` 等核心包。
- B3 没有 `cublasLt.h`，默认 FlashInfer MoE JIT 会失败；必须显式 `VLLM_USE_FLASHINFER_MOE_FP16=0` 走 TRITON MoE。
- 不要把 `TMPDIR` 指到 `<REMOTE_WORK_ROOT>/tmp`，ZMQ IPC 会报 `Operation not supported (addr='ipc://<REMOTE_WORK_ROOT>/tmp/...')`；用 `/tmp`。
- PowerShell 到 SSH 的复杂脚本不要嵌套引号直接传。
- 临时 Bash 脚本用本地 LF 文件按已批准的投递方式落到 `/tmp`，远端必须完整执行 canonical fail-closed 投递门禁（[[debug-basics-1]] 的“远端 Bash 脚本投递必须失败关闭”），避免空脚本、BOM、CRLF 和变量提前展开。
