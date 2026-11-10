---
name: rules-npu-base-image
description: "NPU 基础镜像与 Ascend 升级规则 VLLM-OMNI-PR9143-NPU-BASE-IMAGE（PR #9143）：docker/Dockerfile.npu 与 Dockerfile.npu.ci 同步升级 VLLM_ASCEND_VERSION，两镜像安装 libjemalloc2 并设 LD_PRELOAD，CI 镜像装 pytest-xdist==3.8.0，contiguous-KV fixture 的 MagicMock 显式设 decode_context_parallel_size = 1；docs 推荐 v0.30.0 与 Dockerfile v0.32.0 的差异不是 bug（issue #886）"
metadata:
  scope: 只收 Ascend 镜像版本升级牵连的 Dockerfile、CI、安装文档与测试 fixture 一条规则 VLLM-OMNI-PR9143-NPU-BASE-IMAGE；NPU K/V cache 布局判定与 patch 方式归 rules-npu-kv-layout，NPU 模型 adapter 分层归 rules-npu-model-adapters
---
# Model Executor — NPU 基础镜像与 Ascend 升级规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-npu-base-image.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-20；updated: 2026-10-20
- 来源（sources）：PR #9143
- [VLLM-OMNI-PR9143-NPU-BASE-IMAGE] Ascend 镜像升级是运行时/CI/docs/fixture 的耦合变更
  - 触发：修改 `docker/Dockerfile.npu` 或 `docker/Dockerfile.npu.ci` 的 `VLLM_ASCEND_VERSION`、NPU 安装文档 `docs/getting_started/installation/npu/npu.inc.md`，或 `tests/platforms/npu/test_contiguous_kv_cache.py` 的 MagicMock fixture。
  - 强制：两个 Dockerfile 必须同步升级 `VLLM_ASCEND_VERSION`；运行时与 CI 镜像都要安装 `libjemalloc2` 并设置 `ENV LD_PRELOAD=libjemalloc.so.2`——Dockerfile 注释给出的动机是规避 NPU runtime 下 Python shutdown 阶段的 glibc heap corruption。CI 镜像还必须安装 `pytest-xdist==3.8.0`，以支持默认的 `--dist=loadgroup` 选项。
  - 强制：contiguous-KV fixture 的 MagicMock `vllm_config` 必须显式设置 `parallel_config.decode_context_parallel_size = 1`：Ascend 栈会把该字段与整数比较，未设置的 MagicMock 自动属性会抛 TypeError，显式整数赋值是该 PR 采用的修复方式。
  - 验收：升级 PR 需给出 contiguous-KV NPU 测试（`-m 'core_model and npu and A3 and omni'`）通过，以及至少 Qwen3-TTS / Qwen3-Omni / Wan2.2 级别的 real-weight smoke 无 traceback 退出证据。^[PR #9143]

## 决策与踩坑

- [VLLM-OMNI-PR9143-NPU-BASE-IMAGE] 禁止：把 docs 推荐 v0.30.0 与 Dockerfile 使用 v0.32.0 的差异当作 bug“修正”成一致——文档明确 v0.30.0 镜像不证明与 vLLM 0.32.0 checkout 兼容，对齐版本以 issue #886 为准；也不得只升镜像版本而漏掉 jemalloc/pytest-xdist 就宣称 CI 可用。
