---
name: remote-validation-gates
description: 远端 PR 性能 / 精度验证的 5/10/15 分钟时间门禁：Remote Validation Scope 模板、T+5m Scope 完成、T+10m 三道门禁（head 同步、venv/import ABI、GPU）、T+15m 必须进入目标命令或停下汇报、四条强制停止条件、PASS / FAIL / BLOCKED 报告模板
metadata:
  scope: 只收远端 PR 性能与精度验证任务的时间闸门、停止条件和报告模板；证据是否有效的判定归 evidence-gate，benchmark 口径归 benchmark-scope-1，profiling 状态机归 ar-graph-profiling-1
---
# 远端性能与精度验证时间门禁

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/remote-validation-gates.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-10

### 远端 PR 性能 / 精度验证：先过 5/10/15 分钟闸门，别把准备工作当交付

- **触发条件**：用户明确说“去服务器上跑 PR #xxxx 的性能收益验证和精度验证”“用仓库里已有的，不要自己新写的”。
- 这种任务的交付物只有两类：性能结果、精度结果。同步 PR、找 venv、装依赖、查 GPU 都只是前置条件，不能算进展。开跑前必须写 Remote Validation Scope，且只允许围绕它执行：

```text
Remote Validation Scope
- PR under test: <PR # / head sha>
- Perf command: <repo-existing command/config>
- Accuracy command: <repo-existing command/config>
- Required GPUs: <count + mapping>
- Stop condition: <ABI/import fail | PR target test fail | GPU insufficient | no target command by T+15m>
```

- **时间闸门**：
  1. **T+5m：Scope 必须完成**。没有明确 perf/accuracy 两条现有入口，不准 SSH 长探测；先本地读 repo 文件和 PR body，把命令写出来。
  2. **T+10m：只做三道门禁**。
     - head 同步：远端 worktree 是目标 PR head。
     - venv/import ABI：`import vllm`、`import vllm_omni`、目标测试 collect/import 通过，版本不匹配只能写 blocker。
     - GPU 满足脚本要求：按现有脚本需要的卡数和设备映射确认空闲；不够就停，不为了凑资源改口径。
  3. **T+15m：必须进入目标命令或停下汇报**。如果还在换节点、装依赖、查参数、修 quoting，就是执行失控；必须停，给出 blocker 和下一步，不继续烧时间。
- **强制停止条件**：
  - PR 自带目标测试（例如 step-execution / runner / attention / scheduler 的 targeted pytest）失败：停止。长测只会制造噪音，先报告这个真实失败。
  - 现有 accuracy/perf 入口被 hardware mark skip、GPU 不足、或 venv ABI 不匹配：停止。不要绕过 mark、不要改成别的口径冒充结果。
  - 新 venv / 依赖安装超过 10 分钟还没产出 import ABI 证据：停止汇报环境准备 blocker；不要把安装过程当验证进展。
  - 用户中断后：第一动作是清理本轮 PID/PGID、确认没有自己的 pytest/server/benchmark 残留，再回复。
- **报告模板**：

```text
Status: PASS / FAIL / BLOCKED
Evidence:
- <exact command or log line>
Result:
- perf: <available / blocked + reason>
- accuracy: <available / blocked + reason>
Next:
- <one concrete next step>
```

- **一句话规则**：远端验证任务不是“尽力探索环境”，而是“用现有入口产出指标”。基础目标测试不过、GPU 不满足、或 15 分钟进不了目标命令，就该停；继续探索是在浪费用户 token 和 GPU。
