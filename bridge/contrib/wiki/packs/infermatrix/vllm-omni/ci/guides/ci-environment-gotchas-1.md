---
name: ci-environment-gotchas-1
description: CI 环境坑 runbook（1/2）：libnvJitLink.so.13 需在 Dockerfile.ci 用 ldconfig 注册（CUDA-13 wheels × CUDA-12 基镜像），flashinfer-jit-cache 陈旧残留导致 vLLM 0.25 全部 TP worker 启动即死
metadata:
  scope: 只收环境/镜像/依赖层面的前两条坑（libnvJitLink 动态库注册、flashinfer-jit-cache 版本错配）的症状、诊断、修法、验证和禁止项；Buildkite 互杀、watchdog 误报、entrypoint 超时预算、GPU 竞争 OOM 与症状索引见 ci-environment-gotchas-2，仓库配置坑归 ci-gotchas
---
# CI 环境与基础设施坑（runbook 汇编）（1/2）

## 关键事实

- 拆分说明：本页是源页 `ci-environment-gotchas.md` 的第 1/2 部分；第 2 部分 [[ci-environment-gotchas-2]]
- 源页：`knowledge/repos/vllm-omni/ci/guides/ci-environment-gotchas.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, ci；created: 2026-07-16；updated: 2026-07-20
- 来源（sources）：vllm-omni-rebase-agent@122a9468:agent/skills/fix-bitsandbytes-libnvjitlink-ld-library-path/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/fix-flashinfer-jit-cache-version-mismatch/SKILL.md
  - vllm-omni-rebase-agent@122a9468:agent/skills/buildkite-skipped-build-rebuild-fratricide/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/fix-watchdog-non-fatal-false-positive/SKILL.md
  - vllm-omni-rebase-agent@122a9468:agent/skills/entrypoint-h100-timeout-1800s-runner-mismatch/SKILL.md
- 环境/镜像/管线层面的坑——与 [[ci-gotchas]]（ci-gotchas）（仓库配置坑）分工。运营 runbook 以 rebase-agent 仓库为准，本页是知识树沉淀快照（2026-07-16，agent @122a9468；skills 工作树含未提交遥测更新，快照以工作树为准）。

### 1. libnvJitLink.so.13 需 ldconfig 注册（CUDA-13 wheels × CUDA-12 基镜像）

- skill 元数据：`fix-bitsandbytes-libnvjitlink-ld-library-path`，modules=[worker_runner, model_executor]，status=active，run_count=62（本汇编最高），2026-06-09 创建 / 07-11 最后使用。
- 症状（运行时）：CI 日志 `libnvJitLink.so.13: cannot open shared object file` / `OSError: libnvJitLink.so.13`，随后 `Diffusion worker(s) died unexpectedly`；**单卡过、多卡（spawn worker）挂**。
  - 症状（构建时，v0.24.0+/CUDA-13）：镜像构建在 nvjitlink 步骤失败 `No solution found ... nvidia-cuda-nvjitlink-cu13 was not found in the package registry`（该包名不存在）。
- 诊断：核对基镜像 toolkit 与 wheels 的 CUDA 大版本——v0.24.0 基镜像 `/usr/local/cuda` 是 CUDA **12**，cu130 torch/vllm wheels 需要 `.so.13`；该库 **不在** `/usr/local/cuda/...`，只在 `nvidia-nvjitlink` pip 包里；cu130 torch force-reinstall 已带入 `nvidia-nvjitlink==13.0.88`（构建日志 torch 步可见），库在、只是不在动态加载路径上。
- 修法：`docker/Dockerfile.ci` 在 cu130 torch force-reinstall **之后**，find 定位已装库并用 ldconfig 注册（不要硬装包）：

  ```dockerfile
  RUN NVJITLINK_LIB="$(find / -name 'libnvJitLink.so.13*' 2>/dev/null | head -1)" && \
      if [ -z "$NVJITLINK_LIB" ]; then \
          uv pip install --system "nvidia-nvjitlink-cu13" && \
          NVJITLINK_LIB="$(find / -name 'libnvJitLink.so.13*' 2>/dev/null | head -1)"; \
      fi && \
      test -n "$NVJITLINK_LIB" && \
      dirname "$NVJITLINK_LIB" > /etc/ld.so.conf.d/nvjitlink-cu13.conf && \
      ldconfig && \
      echo "Registered ${NVJITLINK_LIB} with ldconfig"
  ```

  - ldconfig 系统级生效、能活过子进程 env 重置（spawn worker），比 LD_LIBRARY_PATH 稳。未来 CUDA-14 基镜像：`.so.13`→`.so.14`、`-cu13`→`-cu14`。
- 验证：`docker build -f docker/Dockerfile.ci .` 打出 `Registered /.../libnvJitLink.so.13 with ldconfig`（无 "not found in the package registry"）；运行时多卡 diffusion 测试不再 OSError。

### 2. flashinfer-jit-cache 版本陈旧 → 全部 TP worker 启动即死（vLLM 0.25）

- skill 元数据：`fix-flashinfer-jit-cache-version-mismatch`，modules=[worker_runner, model_executor]，status=active，run_count=1，2026-07-12 创建 / 07-12 最后使用。
- 症状：worker 栈止于 `flashinfer/jit/env.py: _get_aot_dir` 的 `RuntimeError: flashinfer-jit-cache version (A) does not match flashinfer version (B)`；
  - import 链 vLLM 0.25 `cuda_communicator.py` → `flashinfer_all_reduce` → `import flashinfer.comm`，**所有 TP worker 一起死**，引擎报 `Orchestrator initialization failed` / `Rank 0 scheduler is dead` / EOFError；硬失败前有 `WARNING "FlashInfer is unavailable; falling back"`。
- 诊断：`pip list | grep -i flashinfer` 出现三个包且 `flashinfer-jit-cache` 版本 ≠ `flashinfer-python`；对照 upstream 期望 `git show <vllm-tag>:requirements/cuda.txt | grep flashinfer`——v0.25.0 只 pin `flashinfer-python==0.6.13` 与 `flashinfer-cubin==0.6.13`，**没有** jit-cache pin；venv 里的 jit-cache 是早期手装残留。
- 修法：卸载残留包（不要用 FLASHINFER_DISABLE_VERSION_CHECK 绕过——那会让错配的缓存 kernel 继续生效），skill 原文命令（本机 venv 解释器）：`/rebase/.venv/bin/pip uninstall -y flashinfer-jit-cache` 后 `/rebase/.venv/bin/python -c "import flashinfer.comm; print('ok', flashinfer.__version__)"`。
  - 没有 jit-cache 时 flashinfer 用匹配的 `flashinfer-cubin`（与 CI 镜像一致），kernel 选择对齐 CI。
- 验证：`import flashinfer.comm` 成功；此前失败的引擎启动（如 TP>1 deploy 的 `examples/offline_inference/hunyuan_image3/end2end.py`）到达 "Loading safetensors" 并完成（2026-07-12 在 vLLM 0.25.0rc4.dev1+gdd10e03f9 的 HunyuanImage3 golden 重基线期间验证）。

## 决策与踩坑

### 1. libnvJitLink.so.13 需 ldconfig 注册（CUDA-13 wheels × CUDA-12 基镜像）

- 禁止：装 `nvidia-cuda-nvjitlink-cu13`（多了 `cuda-`，包名不存在；且无条件安装冗余——torch 依赖已带库）；当基镜像 toolkit 与 wheels 的 CUDA 大版本不一致时依赖 `ENV LD_LIBRARY_PATH=/usr/local/cuda/targets/x86_64-linux/lib`（CUDA-12 基镜像根本没有 `.so.13`，静默失效——该做法只在基镜像已带所需 `.so.N` 时可用）。^[SK-fix-bitsandbytes-libnvjitlink-ld-library-path]

### 2. flashinfer-jit-cache 版本陈旧 → 全部 TP worker 启动即死（vLLM 0.25）

- 禁止：设 `FLASHINFER_DISABLE_VERSION_CHECK` 压错误（错配 kernel 可能加载、数值偏离 CI）；手工把 jit-cache pin 到匹配版本（upstream 对本栈不 ship/不 pin 它，cubin 才是受支持且漂移更小的工件）；重装 vllm/vllm-omni（引擎没坏，只是多了个陈旧包）。^[SK-fix-flashinfer-jit-cache-version-mismatch]
