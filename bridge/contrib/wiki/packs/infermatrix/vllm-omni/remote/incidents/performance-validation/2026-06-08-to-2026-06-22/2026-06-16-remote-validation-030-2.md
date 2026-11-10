---
name: 2026-06-16-remote-validation-030-2
description: "2026-06-16 错题 LTX2.3 PR #4464 性能看护验证跑偏（下）：L4 perf PR 远端验证的 scope lock、PR head fetch、HF gate、public/measurement config 分离、GPU ownership 与 cleanup gate、PR body provenance 及固定流程"
metadata:
  scope: 只收硬规则、下次固定流程与避免要点；症状、有效结果与根因链归 2026-06-16-remote-validation-030-1，同一 PR 后续半冷口径归 2026-06-17-remote-validation-031
---
# 2026-06-16 — LTX2.3 PR #4464 性能看护验证多次跑偏（2/2）

## 关键事实

- 拆分说明：本页是源页 `2026-06-16-remote-validation-030.md` 的第 2/2 部分；第 1 部分 [[2026-06-16-remote-validation-030-1]]
- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-16-remote-validation-030.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- **硬规则**：
  1. L4 perf PR 远端验证前 5 分钟必须写 scope lock：

     ```text
     PR:
     PR head SHA:
     vllm version:
     public config path:
     measurement-only patch:
     HF_HOME / HF_HUB_CACHE:
     snapshot:
     GPU:
     target tests:
     artifact root:
     valid metrics:
     stop condition:
     ```

  2. public PR 测试必须先直接 fetch PR head：

     ```bash
     git fetch origin pull/<PR>/head:refs/remotes/origin/pr-<PR>
     git checkout -B <local-branch> refs/remotes/origin/pr-<PR>
     git rev-parse HEAD
     ```

     - 除非用户明确要测 fork 私有 branch，否则不要依赖远端是否配置 `github-taffy`。
  3. HF gate 必须一次性输出：

     ```bash
     env | grep -E 'HF_HOME|HF_HUB_CACHE|TRANSFORMERS_CACHE|HF_HUB_OFFLINE|TRANSFORMERS_OFFLINE|CUDA_VISIBLE_DEVICES'
     test -d "$SNAP"
     readlink -f "$SNAP"
     python - <<'PY'
     from transformers import AutoTokenizer
     AutoTokenizer.from_pretrained(SNAP, subfolder="tokenizer", local_files_only=True)
     PY
     ```

     - `HF_HOME` 不能凭记忆；没有 live evidence 禁止启动模型。
  4. public config 和 measurement config 要分开：

     ```text
     public config: model id, repo-relative semantics, reviewer/CI-facing
     measurement config: absolute snapshot path only, offline/cache-facing
     ```

     - 最终 PR body 必须说明测量用的是同一 PR head，只替换了本地 snapshot 以满足 offline cache gate。
  5. DFX perf custom dataset 默认用 `dataset-path-inline`。如果必须用 `dataset-path`，要先证明 benchmark 子进程 cwd 下能读到：

     ```bash
     python -c 'from pathlib import Path; print(Path("<dataset-path>").resolve(), Path("<dataset-path>").exists())'
     ```

     - 并检查该路径不被 `.gitignore` 意外吞掉。
  6. 每次启动前重新做 GPU ownership gate：

     ```bash
     nvidia-smi --query-gpu=index,uuid,memory.used,memory.total --format=csv,noheader,nounits
     nvidia-smi --query-compute-apps=pid,process_name,gpu_uuid,used_memory --format=csv,noheader,nounits
     for pid in <candidate-pids>; do readlink -f /proc/$pid/cwd; ps -ww -p $pid -o pid,ppid,pgid,etime,cmd; done
     ```

     - 只选择空闲 GPU；非本轮 cwd 的进程一律 `KEEP`。
  7. 每轮 pytest/benchmark 结束后立刻 cleanup gate：

     ```bash
     for pid in $(nvidia-smi --query-compute-apps=pid --format=csv,noheader,nounits); do
       cwd=$(readlink -f /proc/$pid/cwd 2>/dev/null || true)
       case "$cwd" in "$WT"*|"$OUT"*) echo DELETE; kill -TERM "$pid" ;; *) echo KEEP ;; esac
     done
     ```

     - 清理后必须确认目标 GPU 回到空闲。
  8. 只有 `completed == num_prompts`、`failed == 0`、result JSON 非 fallback、日志显示真实请求完成，才允许汇报 `throughput_qps`、`e2e_latency_ms`、profiling mean。`fallback template` 或 `completed=0` 必须标成无效。
  9. PR body 更新前必须做 provenance gate：

     ```text
     gh pr headRefOid == remote run HEAD
     artifact path exists
     result JSON rows completed/failed valid
     prompt/config matches PR intent
     private debug failures not included
     ```

- **下次 LTX/DFX perf 固定流程**：

```text
1. Fetch PR head from upstream PR ref; print SHA.
2. Read config; print test names, model, dataset fields, workload.
3. Live env gate: venv versions, HF env, snapshot, tokenizer from snapshot.
4. GPU ownership gate; pick one free GPU.
5. Create measurement-only config under OUT; only replace model id with absolute snapshot if offline requires it.
6. Run one target pytest test first, not full sweep.
7. Extract result JSON with completed/failed/qps/latency/profiling.
8. Run remaining target sweep only after first result is valid.
9. Cleanup by cwd/OUT ownership.
10. Update PR body with only valid evidence.
```

- **怎么避免**：这类任务不能把“我能把服务起起来”当进展。进展只按三件事算：当前 PR head 是否被测、目标 workload 是否有效完成、result/profiling 是否可发布。任何一步失败，先修 scope/gate，不要继续换路径、换 cache、换 GPU 做无约束探索。
