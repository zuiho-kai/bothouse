---
name: rules-stage-startup
description: "Stage 启动与设备布局规则：SERV-10a stage config 到 EngineArgs 的显式 projection 与 alias（PR #6050）；SERV-12a 省略 devices 的多副本设备槽位（PR #5445）；SERV-12b 显式 devices 按 TP × local-DP × PP 在 worker 创建前校验（PR #5742）；SERV-12c 串行 LLM 副本按物理 GPU 重叠连通分量分组（PR #7328）；SERV-8b 全局 launch lock 不覆盖 READY 等待（PR #7292）"
metadata:
  scope: 只收 SERV-10a、SERV-12a–12c 与 SERV-8b；runtime.env 的子进程 scope（SERV-8a）与 stage 生命周期归 rules-engine-lifecycle-2，测试 harness 的分卡规则归 rules-stage-cli-tests
---
# Stage 启动与设备布局规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-stage-startup.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-04；updated: 2026-09-22
- 来源（sources）：PR #6050；PR #5445；Issue #5003；PR #5742；vllm_omni/engine/stage_init_utils.py；tests/engine/test_stage_device_layout.py；PR #7328；PR #7292
- 置信度（confidence）：high
- 本页补充 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving 规则） 的 stage 启动边界；stage 生命周期和子进程环境 scope 见 [[rules-engine-lifecycle-1]]、[[rules-engine-lifecycle-2]]（engine 生命周期规则）。
- [SERV-10a] stage config 到 EngineArgs 的投影必须显式且由 owner 进程物化
  - 触发：修改 `stage_init_utils.py` 的 typed stage→`EngineArgs` projection、upstream config 字段映射或 stage startup 的终态配置构造。
  - 强制：AR/generation 从 upstream config dataclass 与 `EngineArgs` 的交集生成 projection map，显式记录且只投影构造时提供的字段，并集中处理 `cache_dtype`→`kv_cache_dtype`、`policy`→`scheduling_policy`、`data_parallel_master_ip`→`data_parallel_address` 等 alias；
    - `CompilationConfig`/`ProfilerConfig` 以具体 upstream object 复制传递，最终 `VllmConfig` 由 engine-owning process 物化，diffusion 保持既有固定 owner 与 projection surface。
  - 验收：非默认 upstream 字段能在最终 EngineArgs 读回且 alias 正确，未显式提供的 inherited defaults 不出现；显式无 projection 字段抛出明确错误；typed projection 保留 compilation/profiler 的 concrete type，structured stage registration 可 msgpack 传输，并回归 legacy/structured effective parity。 ^[PR #6050]
- [SERV-12a] 多副本 stage 省略 devices 时仍按 replica 数生成设备槽位
  - 触发：修改 `split_devices_for_replicas()`、`compute_replica_layout()`、`StageRuntime._build_logical_stage_init_plans()`，或修改 stage 的 `num_replicas` 与可选 `devices` 语义。
  - 强制：当 stage 未声明 `devices` 时，返回与有效 replica 数对应的 `None` 槽位（至少保留一个槽位），使 `replica_devices_map` 和启动计划可按每个 `replica_id` 索引；每个 replica 继承 launcher 的 `CUDA_VISIBLE_DEVICES`，显式设备配置继续按既有规则拆分。
  - 验收：覆盖 1、2、4 副本的未声明设备拆分、三副本 `replica_devices_map` 以及 logical stage init plans 的全部 replica ID 和 `None` 设备值；回归显式设备拆分、模板/池模式及错误路径。^[PR #5445]
- [SERV-12b] 显式 stage devices 必须在 worker 创建前匹配本地副本世界大小
  - 触发：修改 `build_vllm_config()`、`_check_stage_device_layout()`、`get_stage_devices_per_replica()`、`split_devices_for_replicas()`、`compute_replica_layout()`，或修改 stage 的 `devices`、TP、DP、PP、`num_replicas` 解析与启动顺序。
  - 强制：对声明 `runtime.devices` 的每个 LLM stage，在 `create_engine_config` 或 worker/executor 创建前，以同一公式验证并拆分设备：每个本地 replica 需要 `tensor_parallel_size × data_parallel_size_local × pipeline_parallel_size`；`data_parallel_size_local` 未设置时才回退到全局 DP，值为 `0` 的 head process 不做本地设备验证。
    - 显式列表可为单 replica template（恰为每副本大小）或完整 pool（该大小 × `num_replicas`）；未声明 `devices` 时保留 launcher 分配语义。仅当去掉 TP 后设备数恰好有效，错误才说明 top-level TP 会广播到全部 stage，并要求在每个 stage override 中一并设置 TP 与 `devices`；其他 TP/DP/PP/replica 不匹配给通用维度说明。
  - 验收：覆盖 TP 广播的单卡 stage 在 engine-config/executor 前失败、匹配 TP/device 通过、未声明 devices 跳过、local-DP 小于 global-DP 与 local-DP=0、PP/local-DP 加多副本的 template 和 full-pool 拆分，以及 PP-only mismatch 不含 TP 专属 workaround。^[Issue #5003] ^[PR #5742]
- [SERV-12c] 串行 LLM 副本初始化必须按物理 GPU 重叠连通分量分组
  - 触发：修改 `stage_runtime` 的 replica init group、`parse_physical_device_ids`、`device_overlap_group_keys`、`acquire_device_locks` / `spawn_device_lock`，或多 stage 共享/重叠 `runtime.devices` 的启动路径。
  - 强制：本地串行 LLM replica 按已解析物理 device **集合**的连通分量分组：集合相交（含 `{0,1}` 与 `{0}`、`"1,0"` 与 `"0,1"`、传递链）共用同一 `device-group:<sorted union>` 并顺序初始化；不相交集合才并行。非整数 visibility（UUID/MIG）或 unresolved 解析为 `None` 时，该批串行 LLM 收拢为单一 `device-group:*`。
    - diffusion / remote / `parallel_stage_init` 保持既有 per-replica override key。
  - 验收：覆盖重叠/传递重叠同组、不相交异组、非整数 devices 收拢；多 stage `0,1`+`0` 启动不得因 device-lock timeout 无锁继续。^[PR #7328]
- [SERV-8b] 全局 replica launch lock 只覆盖 spawn 与 runtime.env，READY 等待必须释放
  - 触发：修改 `StageRuntime._initialize_local_llm_replica`、`_replica_launch_lock`、`parallel_stage_init`，或多 GPU 多副本启动超时。
  - 强制：全局 launch lock 仅包裹进程 spawn 与 process-global `runtime.env` overlay；launch context 的 READY 等待必须在锁外执行，使不同 device group 可并行完成 load/profile/compile/capture。同 GPU 仍由既有 per-device exclusive lock 串行到 READY；`ExitStack` 管理 launch context 并传播 READY 失败清理。
  - 验收：不同设备并发启动回归必须在未改代码时失败、修复后通过；同设备顺序与 READY 失败后的 resource/device-lock 清理仍成立。^[PR #7292]

## 决策与踩坑

- [SERV-10a] 禁止：维护会随 upstream schema 漂移的静态 allowlist；把 inherited defaults、runtime-owned `worker_cls`/`distributed_executor_backend`、topology-owned `scheduler_cls` 或 private API-process 字段静默送入 EngineArgs；显式提供但没有合法 projection 的字段不得被丢弃，也不得在 head process 解析设备、rank、端口或 backend。
- [SERV-12a] 禁止：因 `devices=None` 只返回单元素列表；让多副本 stage 的启动计划索引越界；将未声明设备误当成显式设备，或改变显式设备配置与既有 `ValueError` 语义。
- [SERV-12b] 禁止：按集群全局 DP 校验本地 `runtime.devices`；让 guard 与 replica splitter 使用不同的每副本宽度；在 engine config/worker 启动后才暴露 `local rank ... out of bounds`；把 PP 或其他布局错误一律归因于 top-level TP；因为没有显式 devices 而拒绝 vLLM 的设备分配。
- [SERV-12c] 禁止：仅用精确 device **字符串**分组，使重叠但不等的集合进入并行线程后，同进程对已持有 inode 的 `flock(LOCK_EX|LOCK_NB)` 自相争并在仍持有 `spawn_device_lock` 时空转到 `stage_init_timeout`。
- [SERV-8b] 禁止：默认路径把 lock 持有到 READY（跨 GPU 串行化整段 init）；为加速而削弱同设备 EX lock；改变 timeout/deploy 阈值来掩盖串行启动。
