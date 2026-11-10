---
name: ci-progress
description: HunyuanImage-3.0-Instruct GEBench CI 接入进展快照：分支 feat/hunyuan-image3-accuracy-ci（HEAD cec2f36b）的 commit 链、关键文件、hk01dgx036 远端环境、已解决的五个环境问题、server 启动后 hang 在 weight load 前的阻塞点、下次排查方向与 pytest 命令
metadata:
  scope: 只收这次 GEBench CI 接入卡在 server hang 时的进展快照；接入全过程的踩坑归档归 legacy-error-summary，对齐交付归 alignment-inventory-1、alignment-inventory-2
---
# HunyuanImage-3.0-Instruct GEBench CI: 当前进展

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/ci-progress.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### 分支

- `feat/hunyuan-image3-accuracy-ci` on `zuiho-kai/vllm-omni`. HEAD `cec2f36b`.

### Commit 链

1. `04a9cfea` — 废弃 GenEval 方案（GenEval 分支保留 pipeline.py + conftest 的 HF 默认注册，这部分还在）
2. `8893468b` — 切换到 GEBench type3/type4 方案（复制 test_gebench_h100_smoke.py）
3. `cec2f36b` — 把 `--stage_0_*` 改成 `--stage-overrides` JSON（argparse 不识别 `--stage_N_*`）

### 关键文件

| 文件 | 作用 |
|---|---|
| `tests/e2e/accuracy/test_gebench_hunyuanimage3_h100_smoke.py` | 新加的 GEBench type3/type4 测试（mirror Qwen 版） |
| `tests/e2e/accuracy/conftest.py` | `hunyuanimage3_gebench_accuracy_servers` fixture |
| `vllm_omni/model_executor/models/hunyuan_image3/pipeline.py` | HUNYUAN_IMAGE3_DIT_ONLY_PIPELINE 注册为 HF model_type 默认（0036 节点验证 vllm 0.19.1 下能起 server） |
| `vllm_omni/config/pipeline_registry.py` | 5 个 HunyuanImage-3 pipeline 注册 |

### 远端环境 (hk01dgx036)

- 容器 `wzr_omni` : image `taichangzhou/vllm-omni-ci:cuda-12.9`
- 挂载 `/home` + `/scratch`
- 模型在 `/home/models/hub/models--tencent--HunyuanImage-3.0-Instruct/` (158GB)
- Git clone 在 `<REMOTE_WORK_ROOT>/fq9hpsacuser03/sources/vllm-omni`
- 主 venv `/app/vllm-omni/.venv`
- 本次安装过的包: `setuptools 82.0.1`, `vllm 0.19.1`, `torchmetrics 1.9.0`, `vllm-omni requirements/common.txt 全装`

### 已解决的问题

1. ✅ `pkgutil.ImpImporter` — setuptools 升到 82
2. ✅ `TokensInput` not found — vllm 升到 0.19.1
3. ✅ `ModuleNotFoundError: janus` — 装 requirements/common.txt
4. ✅ `ModuleNotFoundError: torchmetrics` — 单装
5. ✅ `unrecognized arguments: --stage-0-devices=...` — 改用 `--stage-overrides` JSON

### 当前阻塞点

- Server 启动后 **hang 在 weight load 前**：
  - APIServer (pid 7542) 起来打 logo + 打一行 `weight_utils.py:50 Using model weights format ['*']`
  - 然后 **7+ 分钟没新日志**，没 spawn worker 子进程（TP=4 应该有 4 个）
  - 只有主进程，无 engine core，GPU 几乎空（每卡 <1GB）

### 关键命令（下次接着跑）

```bash
# 进容器
ssh -t fq9hpsacuser03@<REMOTE_HOST> 'tmux attach -t claude_test'

# 如果 tmux 没了：
srun -p q-fq9hpsac -w hk01dgx036 --gres=gpu:4 --cpus-per-gpu=24 --mem-per-cpu=8G --pty bash
docker exec -it wzr_omni bash

# 进容器后：
source /app/vllm-omni/.venv/bin/activate
export HF_HOME=/home/models
cd <REMOTE_WORK_ROOT>/sources/vllm-omni
git config --global --add safe.directory "$(pwd -P)"

# 跑 pytest
pytest -s -vv tests/e2e/accuracy/test_gebench_hunyuanimage3_h100_smoke.py \
  --hunyuan-image3-model=tencent/HunyuanImage-3.0-Instruct \
  --hunyuan-image3-devices=0,1,2,3 \
  --accuracy-judge-model=QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ \
  --accuracy-gpu=6 2>&1 | tee /tmp/gebench_try7.log
```

## 待办

### 下次要排查的方向

- [ ] 直接 vllm-omni serve（不走 pytest / 不走 --stage-overrides）看是不是 HunyuanImage-3 在这版本 vllm-omni main 的通用问题
- [ ] 看 `<REMOTE_WORK_ROOT>/fq9hpsacuser03/sources/vllm-omni/vllm_omni/model_executor/models/hunyuan_image3/` 里 pipeline.py 注册的 DIT_ONLY 和当前 main 的 stage_config 接口是否对得上（我 commit 是 4 月 20 日基于 8a9add1c；main 可能已经演进）
- [ ] Inline print stage_overrides 解析结果，确认 JSON 正确下沉到 engine config
- [ ] 最简 repro：用 Qwen-Image（肯定能跑）验证 fixture 本身 OK，再换回 HunyuanImage-3 对比
