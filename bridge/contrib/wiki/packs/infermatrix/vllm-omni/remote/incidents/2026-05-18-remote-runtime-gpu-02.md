---
name: 2026-05-18-remote-runtime-gpu-02
description: 2026-05-18 错题：vLLM-Omni main 升到 vLLM 0.21 后远端 venv 仍是 0.20，缺 split_routed_experts；只装 vllm --no-deps 又因 system-site-packages 的残缺 flashinfer 与 torch 版本被覆盖而崩，含建 worktree 私有 venv 的修法与避免清单
metadata:
  scope: 只收 2026-05-18 vLLM 0.21 升级后 venv 依赖（vllm、flashinfer、torch）不齐这一起事故；TP=2 的测试 helper 全局 cleanup 归 2026-05-18-remote-runtime-gpu-03，venv 与 scheduler API 漂移的端到端崩溃归 2026-05-18-remote-runtime-gpu-05
---
# 2026-05-18 — vLLM-Omni main 升到 vLLM 0.21 后只装 vllm 本体不够

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/2026-05-18-remote-runtime-gpu-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-18-remote-runtime-gpu-02`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：vLLM-Omni main 升到 vLLM 0.21 后只装 vllm 本体不够
- 影响范围：repos/vllm-omni/remote
- **症状 1**：`upstream/main` 拉到 PR #3630 后，跑 HunyuanImage3 I2T 还没加载模型就 import 崩：

```text
ImportError: cannot import name 'split_routed_experts'
from vllm.model_executor.layers.fused_moe.routed_experts_capturer
```

- **根因 1**：代码已经基于 vLLM 0.21 API，但远端现有 venv 仍是 vLLM 0.20.0 / 0.20.2；这些版本没有 `split_routed_experts`。
- **解法 1**：在当前 worktree 建自己的 `.venv`，不要改共享 venv：

```bash
cd /tmp
uv venv --python /usr/bin/python3 --system-site-packages <REMOTE_WORK_ROOT>/wt-i2t-test-fix/.venv
uv pip install --python <REMOTE_WORK_ROOT>/wt-i2t-test-fix/.venv/bin/python --no-deps -U 'vllm==0.21.0'
```

- 然后验证：

```python
import importlib, vllm
m = importlib.import_module("vllm.model_executor.layers.fused_moe.routed_experts_capturer")
print(vllm.__version__, hasattr(m, "split_routed_experts"))
```

- **症状 2**：只装 `vllm==0.21.0 --no-deps` 后，worker 初始化阶段崩：

```text
ImportError: cannot import name 'BatchDecodeWithPagedKVCacheWrapper' from 'flashinfer'
```

- **根因 2**：`--system-site-packages` 让新 venv 捡到了系统路径里的残缺/旧 `flashinfer` namespace；而 `vllm==0.21.0` metadata 要求：

```text
flashinfer-python==0.6.8.post1
flashinfer-cubin==0.6.8.post1
```

- 只装 vLLM 本体不会补这些依赖。
- **解法 2**：

```bash
cd /tmp
uv pip install --python <REMOTE_WORK_ROOT>/wt-i2t-test-fix/.venv/bin/python --torch-backend cu130 \
  'flashinfer-python==0.6.8.post1' 'flashinfer-cubin==0.6.8.post1'
```

- 安装后确认：

```python
import flashinfer
print(flashinfer.__version__, hasattr(flashinfer, "BatchDecodeWithPagedKVCacheWrapper"))
```

- **注意**：这次 `uv pip install flashinfer...` 顺手把 `.venv` 里的 torch 拉到了 `2.12.0+cu130`，而 vLLM 0.21 metadata 要 `torch==2.11.0`，系统路径已经有 `2.11.0+cu130`。要卸掉 venv 内覆盖的 torch/triton，让它回落到系统 site-packages：

```bash
uv pip uninstall --python <REMOTE_WORK_ROOT>/wt-i2t-test-fix/.venv/bin/python torch torchaudio torchvision triton
```

- 再确认：

```text
torch 2.11.0+cu130
vllm 0.21.0
flashinfer-python 0.6.8.post1
```

- **怎么避免**：
  1. vLLM-Omni main import 新 vLLM symbol 失败时，先查 vLLM 版本和 symbol 是否存在，不要开始改源码：

     ```bash
     python - <<'PY'
     import importlib, vllm
     print(vllm.__version__)
     m = importlib.import_module("vllm.model_executor.layers.fused_moe.routed_experts_capturer")
     print(hasattr(m, "split_routed_experts"))
     PY
     ```

  2. 用 `uv pip install --no-deps vllm==X` 后，必须查 `importlib.metadata.requires("vllm")` 里和 CUDA kernel 相关的 hard deps（flashinfer / torch / triton），逐项补齐或确认系统已有。
  3. `--system-site-packages` 是为了复用大体积 torch/CUDA 包，但它也会暴露系统残缺 namespace。遇到奇怪 `ImportError: cannot import name ... from flashinfer (unknown location)`，先看 `flashinfer.__file__` 和 distribution version。
  4. 用户明确说"新建 venv，把旧的干掉"时，只删除当前 worktree 自己的 `.venv`；删除前 `readlink -f` 确认路径在 worktree 内，绝不碰共享 `<REMOTE_WORK_ROOT>/vllm-omni/.venv`。
