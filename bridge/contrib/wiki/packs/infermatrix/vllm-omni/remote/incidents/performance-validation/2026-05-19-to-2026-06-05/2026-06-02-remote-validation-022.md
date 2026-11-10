---
name: 2026-06-02-remote-validation-022
description: 2026-06-02 错题：HunyuanImage3 AR-only 已有 end2end.py 加 TP2 smoke YAML 的成功路径，却手写 /tmp/hy3_ar_offline_bench.py 连续两轮在 engine READY 前因显存与 cache blocks 报错；含复用已有脚本、1-request parity smoke 的硬规则
metadata:
  scope: 只收 2026-06-02 手写 runner 取代已有成功脚本这一起事故；AR benchmark runbook 本身归 2026-06-02-remote-validation-024，profiler 初始化语义归 2026-06-02-remote-validation-023
---
# 2026-06-02 — HunyuanImage3 AR-only 已有成功脚本，却先手写 runner 导致初始化失败

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-02-remote-validation-022.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-02-remote-validation-022`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：HunyuanImage3 AR-only 已有成功脚本，却先手写 runner 导致初始化失败
- 影响范围：repos/vllm-omni/remote
- **症状**：历史日志已经证明 `examples/offline_inference/hunyuan_image3/end2end.py` + `/tmp/hy3_ar_only_tp2_offline_smoke.yaml` 能在 TP2 AR-only 上跑通，单请求约 8-10s。用户要求继续跑 TP2 benchmark 时，我没有先复用这个成功脚本，而是手写 `/tmp/hy3_ar_offline_bench.py` 批量统计。自写 runner 连续两轮在 engine READY 前失败：

```text
ValueError: Free memory on device cuda:1 ... is less than desired GPU memory utilization
ValueError: No available memory for the cache blocks
RuntimeError: StageEngineCoreProc died during READY
```

- 随后复跑原始 `end2end.py` 同一 TP2 smoke 成功，说明 AR 路径和模型 snapshot 没坏，失败来自自写 runner / 启动口径差异。
- **根因**：
  1. 为了统计方便，重写了 prompt build / sampling params / `Omni.generate` 调用，而不是先在原脚本外包计时。
  2. 没有做 parity gate：自写 runner 没和原脚本对齐 vLLM version、deploy YAML、`max_tokens`、stop token、profiler flag、输出文本。
  3. 把“已有成功脚本”当参考材料，而不是当必须复用的基准入口。
- **硬规则**：
  1. 历史日志或 repo 里已有成功 benchmark/smoke/offline inference 脚本时，正式 run 先复用原脚本；不准先手写等价 runner。
  2. 需要统计 N 次时，优先外包 shell 计时或复制原脚本做最小 patch，只加 loop / JSON output / profiler start-stop，不改 prompt/sampling/Omni kwargs。
  3. 自写 runner 只有在原脚本缺目标能力且无法最小改造时允许；启动前必须跑 1-request parity smoke，对齐原脚本日志和输出。
  4. 自写 runner 失败而原脚本未复跑前，禁止归因模型、显存、接口变更。
- **正确处理模板**：

```text
Known-good entrypoint:
- script:
- deploy:
- venv/python:
- model snapshot:
- command:
- last successful evidence:

Benchmark modification:
- wrapper only / copied script minimal patch / new runner
- if new runner: parity smoke result:
```
