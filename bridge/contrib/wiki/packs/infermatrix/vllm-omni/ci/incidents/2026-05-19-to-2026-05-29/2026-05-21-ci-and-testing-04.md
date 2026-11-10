---
name: 2026-05-21-ci-and-testing-04
description: "2026-05-21 CI 错题 inc-2026-05-21-ci-and-testing-04，PR #3766 的 GitHub pre-commit 因 pipeline_hunyuan_image3.py 未过 ruff format 失败，根因是最后一次 patch 后只跑 ruff check 没跑 ruff format --check"
metadata:
  scope: "只收 2026-05-21 PR #3766 漏跑 ruff format --check 导致 pre-commit 失败这一起错题和 push 前固定两条 ruff 命令的提醒；ruff check 漏跑归 2026-05-19-ci-and-testing-07，PR #3766 的 batching 漏测归 2026-05-26-ci-and-testing-03"
---
# 2026-05-21 — PR #3766 pre-commit 因 ruff format 漏跑失败

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-21-ci-and-testing-04.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-21-ci-and-testing-04`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：PR #3766 pre-commit 因 ruff format 漏跑失败
- 影响范围：repos/vllm-omni/ci
- **症状**：PR #3766 新提交后 GitHub `pre-commit / pre-commit (pull_request)` 21s 失败；日志里 `ruff format` 报 `1 file would be reformatted`，文件是 `vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py`。具体差异只是一个 `raise ValueError(...)` 被 ruff 从多行压成 line-length 允许的单行。
- **根因**：最后一次代码 patch 后，我只跑了 `ruff check`、pytest/py_compile 和 e2e 相关验证，没有跑 `ruff format --check` 或完整 pre-commit。之前已有“提交前跑 ruff check”的硬规则，但 CLAUDE.md C7 写成“需要时再跑 format --check”，给自己留了误判空间；而 pre-commit 实际同时卡 lint 和 format。
- **解法**：本地执行 `python -m ruff format vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py` 修复格式，再跑 `ruff check`、`ruff format --check`、`py_compile`，随后 `git commit --amend -s --no-edit` 并按 Taffy SSH identity `force-with-lease` 推回 PR 分支。新一轮 GitHub `pre-commit` 已通过。
- **对未来的提醒**：只要改过 Python 文件，push 前固定跑两条：`ruff check <changed files>` 和 `ruff format --check --diff <changed py files>`，并且必须在最后一次 edit/amend 前的最终文件状态上跑。pytest、py_compile、远端 e2e 只能证明行为，不证明格式；CI 报 pre-commit/ruff 失败一律按本地验证漏项处理，修完 amend+push 后重新看新 checks。
