---
name: rules-stage-cli-tests
description: "规则 VLLM-OMNI-PR9041-STAGE-CLI-GPU-SPLIT：tests/helpers/runtime.py 的 OmniServerStageCli 每个 stage 只起一个 headless 进程，多副本时追加 --omni-dp-size-local <num_replicas> 分卡，不传 --replica-id（否则各副本叠在同一张卡 OOM，#6843）；验收 tests/helpers/tests/test_runtime_stage_cli.py（PR #9041）"
metadata:
  scope: 只收 stage-CLI e2e 测试 harness 的多副本分卡这一条规则；生产侧 stage devices 与 replica layout 合同（SERV-12a–12c）归 rules-stage-startup
---
# vLLM-Omni Stage-CLI 测试规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-stage-cli-tests.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #9041
- [VLLM-OMNI-PR9041-STAGE-CLI-GPU-SPLIT] Stage-CLI 多副本 stage 每 stage 单进程并用 --omni-dp-size-local 分卡
  - 触发：修改 `tests/helpers/runtime.py` 中 `OmniServerStageCli` 的启动路径（`_build_stage_cmd`、`_launch_stage`、`_start_server`）或 `stage_procs`/`_stage_log_paths`/`_stage_log_files` 簿记；调整 stage-CLI e2e 多副本 overlay（如 `bagel_multi_replicas_4gpu`，PR 时唯一 `num_replicas > 1` 的 stage-CLI overlay）的副本放置。
  - 强制：headless stage 只按 `stage_id` 启动一个进程；当 `stage_replica_counts[stage_id] > 1` 时，命令必须追加 `--omni-dp-size-local <num_replicas>`，由 `serve` 的 headless 分卡把 stage `devices` 池（如 `1,2,3`）拆成每副本一张物理卡。簿记以 `stage_id` 为键，日志名为 `omni_stage_<id>_<port>.log`；
    - 改键结构时确认只遍历 `.values()` 的其他读者（如 `test_gepard_tts.py`）不受影响。此类放置问题在 harness 侧修复并对齐生产 headless 分卡（`stage_engine_startup.py`，文档 `docs/design/module/stage_runtime.md`），不为此改生产代码。
  - 验收：`tests/helpers/tests/test_runtime_stage_cli.py` 断言：多副本 stage 命令含 `--omni-dp-size-local N` 且无 `--replica-id`；单副本 stage 省略该参数；`_start_server` 对每个 stage 只启动一个进程。^[PR #9041]

## 决策与踩坑

- [VLLM-OMNI-PR9041-STAGE-CLI-GPU-SPLIT] 禁止：向 stage-CLI 命令传 `--replica-id`（`serve` 忽略该已弃用参数），或为每个副本各起一个 headless 进程——每个进程会以 `omni_dp_size_local=1` 落到 local device 0 的同一张物理卡，多副本叠放显存导致 OOM（#6843 的故障模式）。
