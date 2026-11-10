---
name: 2026-05-13-kv-reuse-orchestrator-1
description: "2026-05-13 HunyuanImage-3.0 IT2I KV reuse 上半（PR #3444，状态已验证）：S-N=6 病征、根因（AR 一直跑到 eos、omni_kv_config 缺 kv_transfer_criteria）与三层副作用、commit bdc6e184b 的 yaml special_token 与 orchestrator finished_in_batch defer 修法、Bagel 兼容性、验证 S-N=1"
metadata:
  scope: 只收 S-N=6 的病征、根因、第一版修法与验证；六条自我复盘（硬规则 B24 至 B29）和 PR 第二轮 reviewer 反馈的重做归 2026-05-13-kv-reuse-orchestrator-2
---
# 2026-05-13 — HunyuanImage-3.0 IT2I KV reuse — S-N=6 → S-N=1 修复全过程（1/2）

## 关键事实

- 拆分说明：本页是源页 `2026-05-13-kv-reuse-orchestrator.md` 的第 1/2 部分；第 2 部分 [[2026-05-13-kv-reuse-orchestrator-2]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/2026-05-13-kv-reuse-orchestrator.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-13-hunyuan-kv-reuse-orchestrator`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：已验证
- 搜索词：HunyuanImage-3.0 IT2I KV reuse — S-N=6 → S-N=1 修复全过程
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- PR #3444 期间发现的 KV reuse 路径次优 + orchestrator partial output crash 的连环修复。

### 病征

- **同事经验（invariant）**：日志里

```
[AR KV Reuse] Extracted 32 layers of AR KV, each with length: torch.Size([S, 4, 128])
Handling AR KV reuse with positive_reuse_len=N
```

- **正常情况 S - N = 1**（DiT 故意不复用 `</recaption>` 自身，由它重新前向一次保证一致性）。
- **实测（D: 状态）**：10 个 extraction event（5 次 offline + 1 次 online × 2 ranks），**S - N == 6 全部稳定**。

### 根因

#### Step 1: 为啥是 6

- `tokenizer.py:322-323`：`extra_token_pos["<recaption>_end"] = token_count - 1` —— `</recaption>` 的 **0-based 位置**
- `transformer.py:2668`：`positive_reuse_len = think_recaption_end_pos[0][0]` —— 直接用这个位置当切片上界
- `pipeline_hunyuan_image3.py:1328`：`k[:positive_reuse_len]` —— **排除** `</recaption>` 自身
- 所以 **N = K**（K 是 `</recaption>` 的 0-based index）。**S 取决于 AR 实际生成到哪儿**：

| AR 停在哪 | snapshot 包含 | S | S - N |
|---|---|---|---|
| `</recaption>` | ..., `</recaption>` | K+1 | **1** |
| `<answer>` | + `<answer>` | K+2 | 2 |
| `<eos>` | + `<answer>` `<boi>` `<img_size>` `<img_ratio>` `<eos>` | K+6 | **6** |

- D: 状态 `omni_kv_config` 只配了 `need_send_cache: true`，**没有 `kv_transfer_criteria`**。AR scheduler 走兜底路径（`omni_ar_scheduler.py:632` `_mark_request_for_kv_transfer(request_id, confirmed_computed)`）：请求 finish 才做 snapshot，confirmed_computed 含整条序列到 `<eos>`，所以 S - N = 6。

#### Step 2: 副作用（不是 harmless）

- 之前我说 "S-N=6 是 wasted bandwidth, DiT 切到 N 多余 KV 被扔，harmless"。**错**。实际副作用：
  - **AR critical path 多 5 step forward**：AR 要 emit `<answer><boi><img_size><img_ratio><eos>` 5 个 token 才停 → 5 个额外的 forward pass = latency 增加 + compute 浪费
  - **AR pipeline 启动卡到 finish**：kv_ready 信号要等 AR 跑完整条 tail 才发，DiT 失去 "AR 写 cot 时 DiT 起 prefill" 的 pipeline 重叠机会
  - **AR 输出 `generated_text` 含 tail tokens 污染 cot 文本**：`<answer><boi><img_size><img_ratio><eos>` 进了 `ar_output.outputs[0].text`，会传给 DiT 当 cot —— **codex 在 C: 加 `_truncate_at_cot_end` 就是擦这个屁股**
- 只有 "DiT 端切到 N 的 KV 被扔" 这层是 harmless，其他三层都不是。

### 修法

- commit **`bdc6e184b`**（pushed to `fork:pr3444-rgb-condvae`）。两处改动：

#### 改动 1：yaml — cap snapshot at `</recaption>`

- `vllm_omni/deploy/hunyuan_image3.yaml` stage 0 `omni_kv_config` 加：

```yaml
omni_kv_config:
  need_send_cache: true
  kv_transfer_criteria:
    type: special_token
    token_id: 128019  # </recaption>
    stop_after_transfer: false  # AR 继续 emit tail 拿 ratio
```

- `stop_after_transfer: false` 是关键：让 AR 跨过 `</recaption>` 继续 emit `<answer>...<img_ratio>` 给 `ar2diffusion._extract_ratio_index` 抽 ratio_idx
- `kv_transfer_criteria.type=special_token` 让 AR 在 `</recaption>` emit 时 `_mark_request_for_kv_transfer(req_id, snapshot_len=K+1)`

#### 改动 2：orchestrator — defer mid-decode kv_ready forward

- `vllm_omni/engine/orchestrator.py` `_handle_kv_ready_raw_outputs`：
- **问题**：`stop_after_transfer: false` 下，kv_ready EngineCoreOutput 在 AR 还没 finish 时就被 scheduler emit（`omni_ar_scheduler.py:294-300` 在 `if req is not None and not req.is_finished()` 守卫里）。
  - orchestrator 拿到 kv_ready signal 直接 forward 给 bridge，bridge `ar2diffusion: output = ar_output.outputs[0]` —— kv_ready EngineCoreOutput **没有 `.outputs` 字段** → `AttributeError`。
- **修法**：检查同 `raw_outputs` batch 内是否有 finished output for the same req_id：

```python
finished_in_batch = {
    o.request_id
    for o in raw_outputs.outputs
    if getattr(o, "finish_reason", None) is not None
}
...
if req_id not in finished_in_batch:
    continue  # defer to _route_output 的 finish-time forward
```

- AR 真正 finish 时，processed RequestOutput 走 `_route_output` 正常 forward，bridge 拿到完整 output。

#### Bagel 兼容性

- Bagel 用 `kv_transfer_criteria: {type: "prefill_finished"}` + 默认 `stop_after_transfer=True`。这个组合在同一 step emit kv_ready 和 finished output（pending_stop 在同 step fire），`finished_in_batch` 包含 req_id → 原 forward 路径保留。

### 验证

- 远端 `<OTHER_USER_ROOT>/vllm-omni` reset 到 `bdc6e184b`：

```
[AR KV Reuse] Extracted 32 layers of AR KV, each with length: torch.Size([11621, 4, 128])
Handling AR KV reuse with positive_reuse_len=11620

S = 11621, N = 11620, S - N = 1  ✓
```

- AR 生成 621 tokens，ratio_idx=36 抽到 ✓
- target size = 720×1280 landscape ✓（没 fallback 到 square）
- 无 AttributeError ✓
- 图像跟其他 SHM-reuse 跑的同 mode PSNR 在 22-24 dB 范围（合理 same-mode floor）✓
