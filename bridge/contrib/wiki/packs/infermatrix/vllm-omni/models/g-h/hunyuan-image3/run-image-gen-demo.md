---
name: run-image-gen-demo
description: HunyuanImage-3.0 官方 run_image_gen.py 的运行要点：脚本无 TP 参数（device_map=auto 切到所有 GPU），首次 flashinfer JIT 编译 fused_moe_90 假死 7-10 分钟，requirements.txt 之外必装的 tencentcloud-sdk-python-common，4× L20X 的 time budget，最小命令与 --reproduce 的 bit-for-bit 可复现性
metadata:
  scope: 只收 Tencent-Hunyuan 官方仓库 run_image_gen.py 的运行经验；不含 vllm-omni 的运行方式，HF 离线 baseline 的运行步骤归 hf-baseline-runbook-1、hf-baseline-runbook-2
---
# HunyuanImage3 官方 image generation demo 运行

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/run-image-gen-demo.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-07-16

### 适用范围

- 跑 https://github.com/Tencent-Hunyuan/HunyuanImage-3.0 的 `run_image_gen.py`（不是 vllm-omni、不是 HF 离线推理对齐脚本）。

### 关键事实（救命的几条）

#### 1. 这个脚本没有 TP 参数

- `run_image_gen.py` 走 HF `from_pretrained(device_map="auto")`，由 `accelerate` **layer-wise pipeline-style** 切分到所有可见 GPU
- 用户问 "AR tp=2 + DiT tp=2" 在这个脚本里**无法实现**——要 TP 必须走 vllm-omni
- 4 张 sm_90 (Hopper-class) 144G 卡跑 158G 权重，运行时显存约 54/52/49/45 GB（device_map=auto 不均匀）

#### 2. 第一次跑 flashinfer 会"假死"7-10 分钟（不是真卡）

- `--moe-impl flashinfer` 第一次调用会 JIT 编译 cutlass `fused_moe_90` kernel（28+ 并行 nvcc/ptxas 进程）
- 表现：进程 S sleeping、4 卡 GPU util 全 0%、stdout 不动、log size 不增——**看着完全像 deadlock**
- py-spy 抓栈会看到：`subprocess.communicate → run_ninja → flashinfer/jit/cpp_ext.py:342`
- 编译产物存 `~/.cache/flashinfer/<version>/<sm>a/`，第二次起跳过 JIT
- **结论**：第一次跑等 ≥10 分钟再下"hang"判断；用 py-spy + `ps -ef | grep -E "nvcc|ptxas"` 确认是 JIT 而不是死锁

#### 3. 必装依赖（requirements.txt 不全 + 隐式 import）

- 官方 requirements.txt 列了 transformers/diffusers/loguru/einops，但 `run_image_gen.py` line 19 顶层 `from PE.deepseek import DeepSeekClient`，**无论 `--rewrite` 是否为 0** 都会触发 import：

```bash
# requirements.txt 显式
loguru einops tiktoken
# 顶层 import 隐式触发，必装
tencentcloud-sdk-python-common  # 提供 tencentcloud.common.common_client
# 性能（不要可以退到 --moe-impl eager）
flashinfer-python>=0.5.0
```

- `uv pip install` 在 venv 里要用 `cd /tmp && VIRTUAL_ENV=/path/to/venv uv pip install <pkg>`。

#### 4. Time budget 参考（4× L20X 144G sm_90）

| 阶段 | 首次 | 第二次 |
|------|------|--------|
| Load 32 shards (CPFS) | 3 min | 3 min |
| flashinfer JIT cutlass MoE | 7 min | 0（cached） |
| AR think_recaption + 50 步 diffusion | ~2 min | ~2 min |
| **总** | **~12 min** | **~5 min** |

### 跑通最小命令

```bash
cd <OTHER_USER_ROOT>.0  # 必须从 repo 根跑（导 hunyuan_image_3 / PE 包靠相对路径）
source <venv>/bin/activate
export MODEL_PATH=/path/to/snapshots/<hash>
export CUDA_VISIBLE_DEVICES=0,1,2,3

python3 run_image_gen.py \
  --model-id "$MODEL_PATH" --verbose 2 \
  --prompt "..." --seed 42 --reproduce \
  --bot-task think_recaption --image-size auto \
  --use-system-prompt en_unified --infer-align-image-size \
  --image ./assets/demo_instruct_imgs/input_0_0.png \
  --save ./image_edit_0.png --moe-impl flashinfer
```

### 可复现性

- `--reproduce` + 同 seed 能给出 **bit-for-bit 相同**的图（实测 sha256 相同），可放心拿来做 cross-impl PSNR baseline。
