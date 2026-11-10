---
name: full-pipeline-benchmark
description: Full pipeline benchmark gate：2026-06-01 HunyuanImage3 full it2i 反例（默认 MooncakeTransferEngineConnector 不可用，改 shared_memory_connector）、connector gate 命令、指标 gate（ttfc_count / tpot_count / stage_0_gen_ms_count）与报告模板，2026-06-10 AR graph tail-gap 六条诊断规则（DtoD copy、ijson streaming、baseline 与 patch 同脚本、cudagraph key），PowerShell 到 SSH 的坑
metadata:
  scope: 只收 full AR+DiT benchmark 启动前的 connector 与指标可用性 gate，以及随该次调查记录的 AR graph tail-gap 诊断规则和 PowerShell/SSH 坑；benchmark 口径矩阵归 benchmark-scope-1，d-step gap 归因规则归 ar-graph-gap-analysis
---
# Remote Debug · Full pipeline benchmark gate

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/full-pipeline-benchmark.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#3938

### Full pipeline benchmark 的 connector 和指标必须先做可用性 gate

#### Connector gate

- full AR+DiT benchmark 启动前先做：

```bash
grep -n "output_connectors\|input_connectors\|rdma_connector\|shared_memory_connector\|Mooncake" "$DEPLOY"
python - <<'PY'
from vllm_omni.distributed.omni_connectors.factory import OmniConnectorFactory, ConnectorSpec
# 如果默认 connector 是 Mooncake/RDMA，先确认当前 venv 是否安装对应 runtime；
# 不可用时不要长跑，改用同一临时 shared-memory deploy 同时测 baseline/candidate。
PY
```

- 实操上可以用更直接的启动 smoke：若日志出现 `Mooncake not available`，立即停止默认 deploy 方向；改临时 YAML 后重新从 server health 开始。不要把这个错误归因到模型、显存或 PR 性能。

#### 指标 gate

- benchmark JSON 不能只看 stdout 表格标题，必须读字段：

```bash
python - <<'PY'
import json
d=json.load(open("it2i_c1.json"))
assert d["completed_requests"] == 10 and d["failed_requests"] == 0
print("stage0_count", d.get("stage_0_gen_ms_count"))
print("ttfc_count", d.get("ttfc_count"))
print("tpot_count", d.get("tpot_count"))
PY
```

- 规则：
  1. `--stream-ar` / `stream=true` 只说明请求带了 streaming 参数，不说明服务真的吐了 `ar_delta`。
  2. `ttfc_count == 0` 时，TTFC 必须写 `unavailable`。
  3. `tpot_count == 0` 时，TPOT 必须写 `unavailable`。
  4. `stage_0_gen_ms_count == completed_requests` 时，才可以把 `stage_0_gen_ms` 当这轮 AR-stage server-side 主指标。
  5. 临时 connector patch 必须随结果一起落盘：YAML 路径、diff 摘要、main/candidate 是否同用。

#### 报告模板

```text
Config:
- deploy: <path>
- connector: shared_memory_connector (temporary patch applied equally to main and candidate)
- endpoint: /v1/images/edits
- task: it2i

Metric availability:
- stage_0_gen_ms_count=<n>/<completed>
- ttfc_count=0 -> AR TTFC unavailable
- tpot_count=0 -> AR TPOT unavailable
```

- 一句话规则：full pipeline benchmark 前先确认 connector runtime；性能表前先确认每个指标的 count。跑通的 workload 不能自动推出所有指标都可用。

### AR graph tail-gap 诊断规则

- 2026-06-10 HunyuanImage3 AR graph 继续追踪补充：
  1. **短 DtoD copy 不是自动等于瓶颈**：Chrome trace 里每个 decode step 看到多次很短的 `Memcpy DtoD` 时，先按 step window 统计 `kernel/gpu_memcpy/gpu_memset` 的真实 GPU busy/idle。不要只凭视觉把 copy 当 root cause。本轮每步 copy 总量约百微秒；大空白基本被 `cudaGraphLaunch` 覆盖。
  2. **先用 streaming parser 分析大 trace**：正式 trace 可能 1GB/rank、几百万 events。不要 `json.load` 硬读导致超时/无输出；优先用 `ijson` streaming，只保留 step annotation、GPU records、`cudaGraphLaunch`。本轮脚本是 `.scratch/analyze_ar_launch_cadence_stream.py`。
  3. **baseline/patch 都要同一分析脚本**：只看 patch trace 会误以为 tail 是 patch 引入。对照显示 baseline `gap>=1ms` 为 `489/511`，patch 降到约 `120/511`，说明 scalar-sync patch 消掉的是常态等待，剩余 p90/p99 tail 是原有 graph launch 边界。
  4. **不要把 diff=3 误写成 token 语义**：慢 step index 的相邻差值常见 `3`，但 `mod3` 不集中到单一余数；这不是“每第 3 个 AR token 特殊逻辑”。写结论必须说“跨 rank 同步的 graph-launch tail，高频出现在 decode step 串中”，除非拿到 token-id parity 证据。
  5. **探索输入路径必须先保语义**：HunyuanImage3 AR comprehension 没有 `has_preprocess`，decode 固定走 multimodal `inputs_embeds` 路径。粗暴把 decode-only 切成 text-only `input_ids` 已实测只生成 3 tokens，不能作为优化。若要研究 input_ids graph / 双图，先做同 prompt token 数和 token 前缀 parity，再谈性能。
  6. **input mode 必须进 cudagraph key 或分 wrapper**：vLLM `CUDAGraphWrapper` 当前按 `BatchDescriptor` 缓存 graph entry；descriptor 不包含 `input_ids` vs `inputs_embeds`。如果 runtime 改输入模式但复用同一个 FULL graph entry，输出可能被旧 graph 捕获语义污染。做双图实验前先设计 graph key / wrapper 隔离，不准只在 `_preprocess` 里一行切分支。

## 决策与踩坑

### Full pipeline benchmark 的 connector 和指标必须先做可用性 gate

- **2026-06-01 HunyuanImage3 full it2i benchmark 反例 / 修正**：AR-only 路线证伪后，用户要求 4 卡空闲直接跑 full it2i benchmark。服务使用 `hunyuan_image_3_moe.yaml` 默认 TP2+TP2 启动，但默认 connector 是 `MooncakeTransferEngineConnector`：

```text
Failed to create connector MooncakeTransferEngineConnector: Mooncake not available
No connector available for receiving KV cache
```

- 这不是显存问题，也不是 PR #3938 性能问题，而是当前远端 venv/机器没有 Mooncake。修正方式是生成临时 deploy YAML，把 stage0→stage1 connector 从 `rdma_connector` 改成同文件已有的 `shared_memory_connector`，并把这份临时 YAML 同时用于 main 和 PR #3938。这样 full pipeline 可以跑通，但结果只能代表 shared-memory connector 口径。

### AR graph tail-gap 诊断规则

- PowerShell 到 SSH 的补充坑：
  - `@'...'@ | ssh ... 'bash -s'` 可能把 UTF-8 BOM 送到远端，bash 第一行会变成 `$'\357\273\277set'`。复杂远端 Bash 脚本落盘后必须完整执行 canonical fail-closed 投递门禁（源链接 `../../../../general/remote/guides/debug-basics.md#远端-bash-脚本投递必须失败关闭`）；临时 stdin 脚本优先用无 BOM 文件流或直接用远端已有脚本。
  - 远端 `python -c` 的引号在 PowerShell/SSH 双层下容易被吃掉；能用绝对解释器 + stdin 文件流时，不要继续纠缠一行 `-c`。
  - 新终端接手远端任务时，先从当前会话/issue/PR 摘 5 行 runbook（head sha、worktree、venv、tmux、out_dir），不要把已知远端重新 `find` 一遍。
  - 已知有 `<REMOTE_WORK_ROOT>/wt-...` worktree 时，先 `git -C <dir> status` / `rev-parse HEAD` 验证事实；只有不一致才扩大搜索。
  - PowerShell 管道可能因 CRLF/BOM 让路径检查变脏；看到“文档路径不存在”这类结论，先用无 BOM/LF 聚合脚本复查。
