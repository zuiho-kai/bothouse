---
name: 2026-06-01-remote-validation-020
description: "2026-06-01 错题：HunyuanImage3 PR #3938 full it2i benchmark（TP2+TP2、concurrency 1,2,4、/v1/images/edits）跑通后，Mooncake connector 不可用改 shared_memory_connector，--stream-ar 的 ttfc_count / tpot_count 为 0 不得当性能收益，且结果并非提升"
metadata:
  scope: 只收 2026-06-01 full it2i benchmark 的 connector 改写、指标 availability 与结论口径；benchmark 启动无 fail-fast 归 2026-06-01-remote-validation-019，该需求被脑补成 PR3938 对比归 2026-06-02-remote-validation-021
---
# 2026-06-01 — Full IT2I benchmark 跑通后，不能把 unavailable 指标写成性能收益

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-01-remote-validation-020.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-01-remote-validation-020`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：Full IT2I benchmark 跑通后，不能把 unavailable 指标写成性能收益
- 影响范围：repos/vllm-omni/remote
- **背景**：HunyuanImage3 PR #3938 benchmark 最后按用户要求回到 4 卡 full it2i 路线，使用 `origin/main + #3767 overlay` 与 `origin/main + PR #3938 + #3767 overlay`，endpoint `/v1/images/edits`，TP2+TP2，concurrency `1,2,4`，每档 10 requests。
- **遇到的问题**：
  1. **默认 full deploy connector 不可用** `hunyuan_image_3_moe.yaml` 默认 stage0→stage1 用 `rdma_connector` / `MooncakeTransferEngineConnector`。当前远端 venv 没有 Mooncake，服务在 DiT KV receive 阶段报：

     ```text
     Failed to create connector MooncakeTransferEngineConnector: Mooncake not available
     ```

     - 这不是显存问题，也不是候选 PR 性能问题。修复是生成临时 YAML，把两端 connector 同时改成 `shared_memory_connector`，并对 main / PR3938 使用同一临时 deploy。
  2. **`--stream-ar` 没产生 AR TTFC / TPOT 数据** benchmark stdout 显示 `Stream AR (TTFC/TPOT): True`，但 JSON 字段是：

     ```text
     ttfc_count=0
     tpot_count=0
     ar_num_generation_tokens_count=0
     ```

     - 因此这轮只能报告 `stage_0_gen_ms`、`stage_1_gen_ms`、latency、throughput；不能报告 AR TTFC / AR TPOT，也不能说 #3767 的 streaming 指标在 full endpoint 上已经采到。
  3. **结果本身不是性能提升** shared-memory full it2i 口径下，两边均 10/10 成功；PR #3938 c1 基本持平，但 c2/c4 的 `stage_0_gen_ms` 与 latency 回退。结论必须写成“此口径下未见稳定提升”，不能因为 PR 名称是 perf 就预设收益。
- **结果位置**：

```text
<REMOTE_WORK_ROOT>/hy3_ar_bench_20260601_it2i_full/summary.md
<REMOTE_WORK_ROOT>/hy3_ar_bench_20260601_it2i_full/summary.json
```

- **怎么避免**：
  1. full pipeline benchmark 前，deploy connector 是 evidence matrix 的一列；默认 RDMA/Mooncake 不可用时，只能做“同一临时 connector patch 下的对比”，不能写成默认配置结果。
  2. 每个 benchmark 指标都要有 availability gate：`*_count > 0` 或逐条原始样本存在。命令带 `--stream-ar` 不等于 TTFC/TPOT 指标存在。
  3. 结果汇总脚本优先读 JSON 聚合字段，不要从 stdout 复制表格；同时保留 raw JSON 和 server log。
  4. 报告必须区分：
     - workload success：`completed_requests / failed_requests`
     - metric availability：`stage_0_gen_ms_count`、`ttfc_count`、`tpot_count`
     - config caveat：connector、venv、checkpoint、deploy patch
  5. 候选 PR 是性能 PR 也不能预设方向；speedup 公式照算，负数就报告回退。
