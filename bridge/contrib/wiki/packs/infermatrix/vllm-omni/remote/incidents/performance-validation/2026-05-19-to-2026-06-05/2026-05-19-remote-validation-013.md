---
name: 2026-05-19-remote-validation-013
description: "2026-05-19 错题：PR #3606 base commit 在 vLLM 0.21.0 venv 加载 HunyuanImage3 报 _hunyuan_image3_unpack_packed_topk() 缺 num_experts，是旧 base 与当前 vLLM / custom op ABI 不匹配而非性能回归；测旧 PR 前先对 base 与 patch 各建干净 worktree 做 import/init smoke"
metadata:
  scope: 只收 2026-05-19 旧 PR base commit 的 venv/ABI 不匹配这一起事故；同类 venv 与 vLLM 版本问题的运行时依赖面归 2026-05-18-remote-runtime-gpu-02，本批其他性能验证错题见 performance-validation-overview
---
# 2026-05-19 — 测旧 PR 前先做 base commit venv/ABI smoke，别直接跑完整 profiling

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-05-19-remote-validation-013.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-remote-validation-013`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：测旧 PR 前先做 base commit venv/ABI smoke，别直接跑完整 profiling
- 影响范围：repos/vllm-omni/remote
- **症状**：PR #3606 base commit 在 0.21.0 venv 下加载 HunyuanImage3 失败：`_hunyuan_image3_unpack_packed_topk() missing 1 required positional argument: 'num_experts'`。这不是 PR 性能回归，而是旧 base commit 与当前 vLLM / custom op ABI 不匹配。
- **根因**：旧 PR 的 base commit 可能基于不同 vLLM-Omni/vLLM 组合；直接拿当前节点默认 venv 跑完整 e2e，会把环境不兼容误包装成 PR 失败。`local/remote.md` 里的 venv 表只能说明历史用途，不能替代本 PR base smoke。
- **解法**：测旧 PR 顺序固定：
  1. 读 PR 首 commit / base commit，确认年代和目标 vLLM 版本。
  2. 对 base 和 patch 各建干净 worktree。
  3. 先做 import/init smoke：

     ```bash
     PYTHONPATH=<REMOTE_WORK_ROOT>/wt-pr-base $VENV/bin/python - <<'PY'
     import vllm
     print("vllm", vllm.__version__)
     from vllm_omni.model_executor.models.hunyuan_image3.hunyuan_image3 import HunyuanImage3RotaryEmbedding
     print("import ok", HunyuanImage3RotaryEmbedding)
     PY
     ```

     - 对 HunyuanImage3 这类 custom op / MoE 路径，最小 `Omni(...).init` smoke 也要先跑；它通过后才跑 profiling/accuracy。
- **怎么避免**：
  1. 旧 PR 验证不能默认复用“当前 main 可用”的 venv；base commit 必须先 smoke。
  2. `RuntimeWarning: vLLM and vLLM-Omni appear mismatched` 不能当普通噪音，后续任何 crash 都先按版本矩阵处理。
  3. 完整 profiling 前先确认 base 能启动；base 不启动时，结论写“environment/base ABI blocker”，不要写性能收益。
