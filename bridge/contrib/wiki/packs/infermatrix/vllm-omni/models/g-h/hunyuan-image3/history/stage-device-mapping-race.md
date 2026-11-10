---
name: stage-device-mapping-race
description: "ValueError「Stage N has logical IDs … none of which map to visible devices」的两个独立根因与修复（PR #3207 与 commit ca5e329b）：_initialize_stages 的局部锁令多 AsyncOmniEngine 并发时 CUDA_VISIBLE_DEVICES 竞态（改模块级 _STAGE_LAUNCH_LOCK）、_map_device_list 仅支持索引映射（加 value-based 兜底）"
metadata:
  scope: 只收该报错的结论、两个根因、修复与遇到该报错时的判断顺序
---
## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/stage-device-mapping-race.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### 结论

- `ValueError: Stage N has logical IDs … none of which map to visible devices` 有两个独立根因，修复都在 PR #3207 + 追加 commit（`ca5e329b`）。

### 根因 1（主要）：per-instance lock 导致环境变量竞态

- `_initialize_stages`（`async_omni_engine.py` 原 694 行）创建 `llm_stage_launch_lock = threading.Lock()` 为**局部变量**。多个 AsyncOmniEngine 实例并发初始化（如 DP replicas）时各持独立锁，`os.environ["CUDA_VISIBLE_DEVICES"]` 的 save → set → spawn → restore 临界区**不互斥**。
- 竞态时序：
  1. Engine A stage 1 保存 `"0,1,2,3"`，设为 `"2,3"`，spawn 进行中
  2. Engine B stage 0 保存 `"2,3"`（被 A 污染），映射 [0,1]→["2","3"]，spawn，恢复为 `"2,3"`（错误的 saved 值）
  3. Engine A stage 1 恢复 `"0,1,2,3"`
  4. Engine B stage 1：visible=["2","3"]，logical=["2","3"]，索引 2,3 越界 → **crash**
- **修复**：将锁升级为模块级单例 `_STAGE_LAUNCH_LOCK = threading.Lock()`（在 `_STARTUP_POLL_INTERVAL_S` 之后），`_initialize_stages` 中直接引用它。慢速握手已在锁外，不影响启动性能。

### 根因 2（次要）：`_map_device_list` 仅支持索引映射

- 当 `CUDA_VISIBLE_DEVICES="2,3"`（可见列表长度 2），stage config 指定 `devices: "2,3"`（绝对 GPU ID），逻辑 ID [2,3] 作为索引越界，`mapped_devices` 为空。
- **修复**：索引映射完全失败时，兜底做 value-based 匹配——若 ID 字符串存在于可见列表中则直接返回。仅在索引映射完全失败时激活，保留索引语义。

## 决策与踩坑

### Why

- **How to apply:** 遇到类似 "logical IDs … none of which map to visible devices" 报错，先判断是单引擎还是多引擎（DP）场景；多引擎场景优先排查锁是否共享，而非只看映射逻辑。
