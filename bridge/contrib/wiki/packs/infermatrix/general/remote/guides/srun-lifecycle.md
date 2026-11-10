---
name: srun-lifecycle
description: Slurm 资源生命周期：allocation 是唯一资源边界、启动前记录 job/node/GPU、用 run directory 和 PID/PGID 让进程归属可追踪、安全停止六步与验收项
metadata:
  scope: 只收 Slurm allocation 内的资源边界、进程归属记录、安全停止和释放验收；serving / pytest 的 fail-fast 与清理脚本归 serving-failfast-cleanup
---
# Slurm 资源生命周期

## 关键事实

- 源页：`knowledge/general/remote/guides/srun-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 原则

- Slurm 分配的 CPU、GPU、内存和节点是本轮任务唯一允许使用的资源边界。容器、子进程和环境变量不能扩大这个边界；看到其他 GPU 空闲也不代表获得了使用权。

### 启动前记录

```bash
echo "job_id=${SLURM_JOB_ID:-none}"
echo "node=$(hostname)"
echo "cuda_visible_devices=${CUDA_VISIBLE_DEVICES:-unset}"
pwd -P
```

- 确认 `CUDA_VISIBLE_DEVICES` 与调度器分配一致。需要更多 GPU 时重新申请资源，不在现有 allocation 外自行选择设备。

### 让进程归属可追踪

- 为本轮创建独立 run directory，记录 launcher PID、PGID、容器 ID 和日志。推荐由一个受控 wrapper 启动所有子进程，并在状态文件中保存实际 ID。

```bash
RUN_DIR=<verified-run-dir>
mkdir -p "$RUN_DIR"
setsid bash <verified-script> >"$RUN_DIR/run.log" 2>&1 &
launcher_pid=$!
launcher_pgid=$(ps -o pgid= -p "$launcher_pid" | tr -d ' ')
printf '%s\n' "$launcher_pid" >"$RUN_DIR/launcher.pid"
printf '%s\n' "$launcher_pgid" >"$RUN_DIR/launcher.pgid"
```

- `<verified-run-dir>` 必须是本轮已确认的绝对路径。不要把占位符直接执行。

### 安全停止

1. 读取本轮状态文件。
2. 用 `ps` 验证 PID/PGID 的 cwd、command 和 owner 都属于本轮。
3. 先向已验证的本轮进程组发送 TERM。
4. 等待并再次检查；只有仍属于同一进程组的残留进程才能升级处理。
5. 容器内进程按本轮记录的 PID 或容器 ID处理，不按名称扫描整个节点。
6. 退出本轮容器和 srun shell，最后用 `squeue -j "$SLURM_JOB_ID"` 确认 allocation 已释放。

- 无法证明归属时停止并报告，不猜测、不扩大清理范围。

### 验收

- 本轮 launcher 和已记录子进程均退出；
- 本轮端口、文件锁和容器不再存在；
- Slurm job 已结束；
- 未触碰其他 allocation 或用户进程；
- GPU 状态只用于确认本轮释放结果，不用于寻找可绕过调度器使用的设备。

## 决策与踩坑

### 原则：禁止

- 禁止：
  - 使用未分配的 GPU；
  - 让容器暴露整个节点设备来绕过调度器；
  - 按进程名全局终止任务；
  - 在无法证明 PID、PGID、容器或目录属于本轮时清理资源。
