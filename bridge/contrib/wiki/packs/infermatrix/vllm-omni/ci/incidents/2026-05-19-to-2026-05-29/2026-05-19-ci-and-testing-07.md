---
name: 2026-05-19-ci-and-testing-07
description: 2026-05-19 CI 错题 inc-2026-05-19-ci-and-testing-07，提交前没跑 ruff check，PR CI 报 serving_chat.py:2583 F841 未使用变量 negative_prompt，删除变量后 amend 重推
metadata:
  scope: 只收 2026-05-19 提交前漏跑 ruff check 被 F841 打回这一起错题；ruff format 漏跑归 2026-05-21-ci-and-testing-04，整个 PR 的交付复盘归 2026-05-19-ci-and-testing-08
---
# 2026-05-19 — 提交前没跑 ruff，CI 被 F841 未使用变量打回

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-19-ci-and-testing-07.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-ci-and-testing-07`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：提交前没跑 ruff，CI 被 F841 未使用变量打回
- 影响范围：repos/vllm-omni/ci
- **症状**：PR CI 的 `ruff check` 失败：`vllm_omni/entrypoints/openai/serving_chat.py:2583:9: F841 Local variable negative_prompt is assigned to but never used`。
- **根因**：本地只跑了 `py_compile`、focused pytest 和远端功能测试，没有跑覆盖本次改动文件的 `ruff check` / pre-commit lint。新增 streaming helper 时留下了 `extra_body.get("negative_prompt")`，功能测试不触发，但 ruff 能直接抓到。
- **解法**：删除未使用变量，执行 `python -m ruff check vllm_omni/entrypoints/openai/serving_chat.py vllm_omni/entrypoints/openai/api_server.py tests/entrypoints/openai_api/test_image_server.py`，再 amend + push。
- **对未来的提醒**：任何提交/推 PR 前都要跑覆盖本次改动文件的 `ruff check`；如果本地有 pre-commit 环境，优先跑对应 hook。`py_compile` 和 pytest 只能证明语法/行为，不覆盖风格和未使用变量。
