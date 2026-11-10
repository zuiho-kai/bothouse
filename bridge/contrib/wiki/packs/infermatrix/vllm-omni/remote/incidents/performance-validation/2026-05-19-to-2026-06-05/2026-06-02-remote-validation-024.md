---
name: 2026-06-02-remote-validation-024
description: "2026-06-02 错题：HunyuanImage3 AR benchmark（main + #3767、TP2、算子 top10、端到端开销）已有可复用 runbook，记录 host、worktree、python、模型 snapshot、deploy、输入图与 steady / profile / graph 各 artifact 路径，禁止下次从头摸索"
metadata:
  scope: 只收 2026-06-02 HunyuanImage3 AR benchmark 的可复用环境事实、artifact 路径与复用规则；profiler 启停与 xlsx/trace 口径的具体问题归 2026-06-02-remote-validation-023
---
# 2026-06-02 — HunyuanImage3 AR benchmark 已有可复用 runbook，禁止下次从头摸索

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-02-remote-validation-024.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-02-remote-validation-024`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：HunyuanImage3 AR benchmark 已有可复用 runbook，禁止下次从头摸索
- 影响范围：repos/vllm-omni/remote
- **触发条件**：用户说 HunyuanImage3 AR benchmark / main + #3767 / TP2 / 算子 top10 / 端到端开销。
- **直接复用的事实**：

```text
host=root@<REMOTE_HOST> -p 31342
worktree=<REMOTE_WORK_ROOT>/wt-hy3-ar-bench-main
python=<OTHER_USER_ROOT>/vllm-omni-022/.venv/bin/python
model=/root/.cache/huggingface/hub/models--tencent--HunyuanImage-3.0-Instruct/snapshots/2ec2c78bee7d4b94157341fba86c4c2c7b1858b2
deploy=/tmp/hy3_ar_only_tp2_orig_smoke.yaml
input_image=/tmp/hy3_input_0_0.png
devices=0,1
```

- **直接复用的结果 / artifact**：

```text
steady_summary=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_minpatch/summary.json
profile_report=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img/report.md
top_gpu_kernels=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img/top_gpu_kernels.json
graph_summary=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_minpatch/summary.json
graph_report=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_minpatch/report.md
graph_profile_report=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_profile/report.md
graph_profile_top_gpu_kernels=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_profile/top_gpu_kernels.json
```

- **硬规则**：
  1. 下次先检查这些路径是否还存在和 GPU 是否空闲；不要重新找 endpoint、不要重新写 runner。
  2. 如果 artifact 还在且用户只要“之前日志/结果”，直接读 artifact 回答。
  3. 如果用户要刷新 benchmark，复用已存在 repo-local temporary minimal patch 或从原 `examples/offline_inference/hunyuan_image3/end2end.py` 再做最小 patch。
  4. profiler top10 直接沿用 trace JSON 聚合口径；xlsx CUDA 列为空是已知现象，不要再卡在 xlsx。
  5. 任何新变体必须先写和 runbook 的差异：HEAD / TP / image / deploy / profiler / request count。没有差异说明，就按 runbook 跑。
  6. 图模式 / graph mode 已有结果和路径；刷新时只把 deploy 的 `enforce_eager` 改成 `false`，不要换脚本/输入/TP。graph mode 报告必须把一次性 compile/init cost、steady-state latency、profiler top10 三者分开；只跑 graph latency 不等于完成“前 10 算子开销”需求。
