---
name: 2026-06-05-remote-validation-025
description: "2026-06-05 错题：PR #4041 性能与精度远端验证执行失控，在 B3/B4/B1/B2 间发散探索，PR 自带目标测试 test_denoise_step_uses_input_batch_group_order_and_splits_back 已失败仍继续长测，用户中断后残留 pytest 进程；含 5/10/15 分钟闸门、Remote Validation Scope 与 BLOCKED 报告模板"
metadata:
  scope: "只收 2026-06-05 PR #4041 验证目标不收敛、停损点失效与中断清理滞后这一起事故；该 PR 之后跑错 workload 归 2026-06-15-remote-validation-002，复盘落盘位置错误归 2026-06-17-remote-validation-001"
---
# 2026-06-05 — PR #4041 性能/精度远端验证执行失控，准备工作冒充进展

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-05-remote-validation-025.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-05-remote-validation-025`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：PR #4041 性能/精度远端验证执行失控，准备工作冒充进展
- 影响范围：repos/vllm-omni/remote
- **症状**：用户要求“去服务器上跑 vllm-project/vllm-omni#4041 的性能收益验证和精度验证，用仓库里已有的，不要自己新写的”。我没有在前 5 分钟锁定两条现有命令，而是在 B3/B4/B1/B2 节点、venv、依赖、GPU 资源之间扩散探索。期间虽然发现了有价值信号：

```text
old venv: vLLM 0.21.0 ABI mismatch, _resolve_module_name import failure
new venv: vLLM 0.22.0 + editable PR #4041
targeted pytest: 31 passed, 1 failed
failure: test_denoise_step_uses_input_batch_group_order_and_splits_back
reason: HunyuanImage3Pipeline.pipeline is a property with no setter
```

- 但我没有在 PR 自带目标测试失败时停下汇报，反而继续尝试 full accuracy / perf。accuracy 因 hardware mark / GPU 不足只得到 skip，perf 在用户中断后还留下本轮 pytest 进程，需要事后清理。最终没有交付用户要求的性能收益或精度指标，浪费了用户时间和 token。
- **根因**：
  1. **目标未收敛**：把“跑性能收益验证 + 精度验证”当成开放式远端探索，而不是两条 repo-existing command 的执行任务。
  2. **停损点失效**：PR 自带 step-execution 目标测试已经失败，这足以阻断长测；我却继续追求 perf/accuracy 表。
  3. **准备工作冒充进展**：建 venv、查依赖、切节点、查 GPU 都是门禁，不是验证结果；没有 10/15 分钟闸门约束。
  4. **资源口径失控**：现有 full accuracy/perf 脚本需要固定 GPU 数和 hardware mark；GPU 不足时应该汇报 blocker，而不是临时换成不等价的可跑口径。
  5. **中断清理滞后**：用户中断后必须第一时间清本轮 PID/PGID；这次是被用户追问后才处理残留。
- **硬规则**：
  1. 远端 PR 性能/精度验证前 5 分钟必须写：

     ```text
     Remote Validation Scope
     - PR under test:
     - Perf command:
     - Accuracy command:
     - Required GPUs:
     - Stop condition:
     ```

  2. 前 10 分钟只允许做三道门禁：PR head 同步、venv/import ABI、GPU 满足现有脚本要求。门禁失败就汇报 blocker，不继续探索。
  3. 15 分钟仍未进入目标 perf/accuracy 命令，必须停下汇报当前 blocker；禁止继续换节点、装依赖、查参数。
  4. PR 自带目标测试失败（step-execution / runner / attention / scheduler 等）后，停止长测；报告该失败是当前 head 的基础 blocker。
  5. 现有脚本因 hardware mark skip / GPU 不足不能跑时，只能写资源 blocker；不能绕过 mark 或改成别的口径冒充精度/性能验证。
  6. 用户中断远端长跑后，第一动作固定为查并清本轮 PID/PGID，确认无 `codex_<task>` / pytest / benchmark 残留，再回复。
- **正确处理模板**：

```text
Status: BLOCKED
Evidence:
- PR head: <sha>
- Venv/import: <pass/fail exact line>
- Targeted test: <pass/fail exact test>
- GPU gate: <required vs available>

Result:
- perf: not run, because <blocker>
- accuracy: not run, because <blocker>

Next:
- <fix PR target test / wait for N GPUs / prepare matching venv>
```

- **怎么避免**：把“有没有产出目标指标”作为唯一进展尺。只要当前动作不能在下一步直接推进 perf/accuracy 命令，就必须问自己是不是偏航；超过闸门直接停。
