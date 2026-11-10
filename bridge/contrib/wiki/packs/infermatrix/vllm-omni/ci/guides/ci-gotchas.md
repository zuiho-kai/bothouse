---
name: ci-gotchas
description: "vLLM-Omni CI 配置坑：.gitignore 排 *.json 须 git add -f、单阶段 diffusion pipeline 必须 async_chunk false、Hunyuan perf test 自 PR #2495 起从 mandatory CI 拆出、CI 红时自动调查 GitHub Actions 与 Buildkite 日志的步骤"
metadata:
  scope: 只收 vLLM-Omni 仓库侧反复踩到的 CI 配置坑（JSON test config、async_chunk 默认值、Hunyuan perf step）及 CI 红时的自动调查流程；镜像/依赖/管线/超时等环境坑归 ci-environment-gotchas-1 和 ci-environment-gotchas-2，历史失败证据归 ci-incidents-overview
---
# vLLM-Omni CI 配置坑（gotchas）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/guides/ci-gotchas.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, ci；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#2495
- vllm-omni CI 上反复踩到的三个具体配置坑——合一篇。

### 1. .gitignore 排 *.json，新增 JSON test config 必须 git add -f

- vllm-omni 的 `.gitignore` line 241 有 `*.json`，会忽略所有 JSON 文件。
- **How to apply:** 新增 JSON test config 文件时必须 `git add -f <file>` 强制添加，否则 git status 不会显示为 untracked，容易漏提交。

### 2. 单阶段 diffusion pipeline 必须 async_chunk: false

- 单阶段 diffusion 模型（如 HunyuanImage3 DIT_ONLY）启动时必须加 `--no-async-chunk`，或创建 deploy YAML。
- **How to apply:**
  - 永久修法：创建 `vllm_omni/deploy/<model_type>.yaml`，写 `async_chunk: false`
  - 临时修法：启动命令加 `--no-async-chunk`
  - 判断依据：单阶段 pipeline（只有 DiT，没有 AR→DiT bridge）= 必须 `async_chunk: false`

### 3. Hunyuan perf test 已从 mandatory CI 拆出

- PR #2495 把 HunyuanImage3 perf test 从 mandatory "Diffusion X2I(&A&T) · Perf Test" 拆出。
- **How to apply:**
  - Hunyuan perf test 现在是独立 Buildkite step，`soft_fail: true` + `RUN_HUNYUAN_IMAGE3_PERF=1` env gate（默认不跑）
  - 模型从 `tencent/HunyuanImage-3.0` 改为 `tencent/HunyuanImage-3.0-Instruct`（CI 节点 HF cache 里有 Instruct，没有 base，避免 30 分钟下载 + startup timeout）
  - 原来一个 JSON（3 个 test case）拆成 3 个独立 JSON（tp4_fp8, tp2_fp8_sp2, tp2_fp8_cfgp2），每个 pytest 调用只起一个 server，防止显存残留
  - profiling 脚本从 `scripts/profiling/` 移到 `tools/`，shell 脚本改为通用（model 作为 CLI 参数）

### 4. CI 红时自动调查外部 check

- 用户说“CI 炸了”、check fail 或贴出红色 PR 时，自动完成 GitHub Actions 和外部 CI 的日志调查，不先问“是否继续查 Buildkite”。
1. 刷新当前 PR head、完整 checks 和 diff。
2. GitHub Actions 用 `gh run view --log`；Buildkite 先打开公开 build 页面，从页面里的 `build_data_base_path` 读取：
   - `<build_data_base_path>/steps?exclude_group_steps=true&state=failed`
   - 每个失败 step 的 `statistics.latest_job_id`
   - `/organizations/<org>/pipelines/<pipeline>/builds/<build>/jobs/<job_id>/log`
3. Buildkite API 返回 `401` 时自动降级到公开页面和上述 data/log 端点；只有公开端点也拒绝日志时才报告权限边界。
4. 对每个失败 job 提取 exact step、命令、第一处真实错误和最终 summary，再与当前 PR diff、producer/consumer owner 对照，分别标记“PR 导致”“无关”“证据不足”。
- 调查是自动动作；修改 PR 代码或触发外部 rerun 仍遵守对应的写入和权限边界。

### 相关

- 历史 CI 失败的完整证据链见 [[ci-incidents-overview]]（CI incidents）。
- 新增测试/CI 前先按 先检查现有测试（源链接 `../../../../general/ci/guides/inspect-existing-tests-first.md`） 确认已有覆盖。

## 决策与踩坑

### 1. .gitignore 排 *.json，新增 JSON test config 必须 git add -f

- **Why:** 项目里有大量生成的 JSON（benchmark results 等），所以全局忽略。但 `tests/dfx/perf/tests/*.json` 是手写的 test config，需要被 track。

### 2. 单阶段 diffusion pipeline 必须 async_chunk: false

- **Why:** `DeployConfig.async_chunk` 默认 `True`。没有 deploy YAML 时用默认值。单阶段 pipeline 没有 next-stage processor，`async_chunk=True` 直接报 `ValueError`。

### 3. Hunyuan perf test 已从 mandatory CI 拆出

- **Why:** Hunyuan 80B MoE 在 CI 4×H100 上 dummy run OOM（原因：多个 parametrized test case 在同一 pytest session 里 server 没杀干净就起下一个，显存叠加爆了）。EXIT5 传播到 Qwen step 的 exit code，导致整个 mandatory step 失败。
