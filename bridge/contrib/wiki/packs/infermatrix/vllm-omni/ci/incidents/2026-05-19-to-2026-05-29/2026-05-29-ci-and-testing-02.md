---
name: 2026-05-29-ci-and-testing-02
description: "2026-05-29 CI 错题 inc-2026-05-29-ci-and-testing-02，PR #3734 新测试激活主线 gpu_ar_model_runner.py 的 query_start_loc.cpu dormant typo，首次修复改成 .cpu() 又在真实 runner 报 'Tensor' object is not callable，最终用 duck-typed 取值并参数化单测"
metadata:
  scope: "只收 2026-05-29 PR #3734 激活旧 typo 且第一次修复误判真实 runner abstraction 这一起错题及最小 smoke 须覆盖真实接口形态的提醒；之后的 chat_template 入口错题归 2026-05-29-ci-and-testing-01"
---
# 2026-05-29 — PR #3734 新路径激活主线 dormant typo，第一次修复误判真实 runner abstraction

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-29-ci-and-testing-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-29-ci-and-testing-02`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：PR #3734 新路径激活主线 dormant typo，第一次修复误判真实 runner abstraction
- 影响范围：repos/vllm-omni/ci
- **症状**：PR #3734 被要求 fix CI 后，Buildkite `vllm-omni` 和 `vllm-omni-amd-ci` 都失败在 `tests/worker/test_gpu_ar_model_runner.py::test_sample_tokens_tail_only_prefix_cache_uses_staged_cpu_hidden_states`。
  - 错误是 `TypeError: 'builtin_function_or_method' object is not subscriptable`，位置在 `gpu_ar_model_runner.py` 的 `query_start_loc_cpu[idx]`。第一版修复把它改成 `self.query_start_loc.cpu()` 后，下一轮 Linux / AMD / Intel 多个真实 runtime step 全部变成 `TypeError: 'Tensor' object is not callable`，位置是同一行。
- **根因**：`query_start_loc_cpu = self.query_start_loc.cpu` 这行主线旧代码在单测假对象里拿到的是 bound method，不是 CPU tensor；过去常见路径只赋值不索引，所以 dormant。PR #3734 的 tail-only prefix-cache hidden-state payload 测试第一次让这条路径消费 `query_start_loc_cpu`，于是旧 typo 变成当前 PR 的 CI failure。
  - 但真实 runner 里的 `query_start_loc` 不是裸 `torch.Tensor`，而是带 `.cpu` tensor 属性的 buffer wrapper；我把单测对象的 `torch.Tensor.cpu()` 语义直接套到真实 runner 上，造成第二轮 CI 在真实路径里反向报 `'Tensor' object is not callable`。
  - 真正流程问题不是“谁写了 typo”，而是本地 pytest 因 `ModuleNotFoundError: No module named 'vllm'` 无法启动后，我只保留了 `ruff` / `ruff format --check` / `py_compile`，且最小 smoke 只覆盖裸 Tensor 形态，没有覆盖真实 runner 的 `.cpu` 属性形态。
- **解法**：改成兼容真实 runner 和裸 Tensor 的 duck-typed 获取方式：先读 `query_start_loc_cpu = self.query_start_loc.cpu`，如果它是 callable 才调用一次。把新增单测参数化，覆盖 `runner.query_start_loc = torch.tensor(...)` 的方法形态，以及 `runner.query_start_loc = SimpleNamespace(cpu=torch.tensor(...))` 的真实 runner 属性形态。
  - 重新跑 changed-file `ruff check`、`ruff format --check --diff`、`py_compile`，再用最小同逻辑 smoke 验证两种形态都可索引，随后 amend + DCO sign-off，用 Taffy SSH identity `force-with-lease` 推回 PR 分支。
- **对未来的提醒**：
  1. PR 新增/扩大执行路径后，被激活的主线旧代码也属于本 PR 行为面；`git blame` 只能解释来源，不能作为跳过修复/验证的理由。
  2. 新增/修改测试本地跑不起来时，不能用 `ruff` / `py_compile` 代替行为验证；必须切到 CI-like 容器/远端，或写一个绕开全 pytest fixture 但执行同一核心分支的最小 smoke。
  3. 最小 smoke 不能只证明自己造的 fake 能跑；必须对照真实 runner abstraction，尤其是 property vs method、CPU/GPU buffer wrapper、`.np` / `.cpu` / `copy_to_gpu()` 这类非裸 Tensor 接口。不确定时把测试参数化覆盖两种形态。
  4. runner / prefix-cache / pooler payload / shared execution state 改动的状态矩阵要包含“旧变量第一次被消费”的路径，尤其是赋值后才索引/切片/调用的中间变量。
  5. 修 CI 时先从失败日志收敛到一个确定根因，再改最小 patch；不要因为 typo 是旧代码就扩大 scope 顺手清理同类文件。
