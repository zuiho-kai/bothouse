---
name: rules-admission-wait
description: Diffusion admission wait 规则 DIFFADM-1a 至 1d：Scheduler 给出 _AdmissionWaitDecision 而 Engine 只做条件等待、RequestScheduler 仅为可扩大的空闲 wave 等待（稳定窗 min(50ms, max_wait/5)，DP concurrent min(300ms, max_wait/2)）、request_batch_max_wait_ms 拒绝 nan/inf/负数、pause mode=keep 关闭 scheduling gate 并做全 rank barrier
metadata:
  scope: 只收 scheduling wave 之前的 coalescing wait 与 pause keep 规则（DIFFADM-*）；request/step batching 的能力矩阵归 step-and-batching
---
# Diffusion admission wait rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-admission-wait.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion, scheduler；created: 2026-08-10；updated: 2026-10-09
- 来源（sources）：docs/mkdocs/hooks/generate_argparse.py；vllm_omni/diffusion/data.py；vllm_omni/diffusion/diffusion_engine.py；vllm_omni/diffusion/sched/base_scheduler.py；vllm_omni/diffusion/sched/interface.py；vllm_omni/diffusion/sched/request_scheduler.py；vllm_omni/entrypoints/cli/serve.py
  - tests/diffusion/test_diffusion_engine.py；tests/diffusion/test_diffusion_engine_rpc_routing.py；tests/diffusion/test_diffusion_scheduler.py；tests/entrypoints/test_async_omni_diffusion_config.py；PR #5843；PR #7685
- 只有 `DIFFADM-数字字母` 是可审计规则 ID。request/step batching 的能力矩阵先查 [[step-and-batching]]（step and batching），本页只拥有 scheduling wave 之前的 coalescing wait。
- [DIFFADM-1a] Scheduler 决定 wait policy，Engine 只执行条件等待
  - 触发：修改 diffusion busy loop、scheduler interface、request-wave batching、DP concurrent coalescing 或 admission wait 配置。
  - 强制：Engine 持有 condition 和 monotonic clock，向 scheduler 请求一次内部 `_AdmissionWaitDecision`，循环中只观测 waiting count、刷新 `stable_since`、调用 `should_end_admission_wait()`，并用最多 2ms 的 condition wait 响应新请求/stop。Base/step/custom scheduler 默认 no-wait；`RequestScheduler` 才拥有 static-wave coalescing policy。
  - 验收：mock scheduler 证明 Engine 遵从 policy；Base/Step 返回 no-wait；RequestScheduler 分别覆盖 disabled、active、已有 running wave、serial capacity、full batch、stable window、deadline 与 stop_event。RPC/abort 唤醒和 shutdown 仍不能被 admission wait 饿死。^[PR #5843]
- [DIFFADM-1b] RequestScheduler 的等待只为可扩大的空闲 wave
  - 触发：修改 `request_batch_max_wait_ms`、`max_num_seqs`、DLO DP concurrent 或 request queue admission。
  - 强制：仅当 max wait > 0、`max_num_running_reqs > 1` 且没有 running request 时等待。deadline 为 start + max wait；普通稳定窗是 `min(50ms, max_wait/5)`，DP concurrent 是 `min(300ms, max_wait/2)`。waiting 达 max batch、非空队列在稳定窗内不再增长、或到 deadline 任一成立即结束。
  - 验收：对普通/DP 两种稳定窗做精确 decision 测试，并证明每次 waiting count 增长都会重置 `stable_since`。测试 fixture 构造真实 `RequestScheduler` 时必须显式提供 `request_batch_max_wait_ms`，否则后台 busy loop 的 `AttributeError` 会伪装成超时。^[PR #5843]
- [DIFFADM-1c] wait duration 与内部 decision 都要防止 non-finite hot spin
  - 触发：CLI/config 接受 admission duration，或 scheduler extension 改 decision 数据结构。
  - 强制：CLI argparse 与 `OmniDiffusionConfig.__post_init__` 都只接受 finite non-negative float；`nan`、正负 `inf` 和负数在启动边界拒绝。内部 decision 保持私有，缩小第三方构造无效状态的接口面。
  - 验收：Python config 与 CLI 都覆盖 `nan|inf|-inf|negative|zero|finite positive`；docs argparse extraction 必须为自定义 type 提供安全 stub。当前私有 `_AdmissionWaitDecision` 自身没有 `__post_init__` invariant validation，安全性依赖 only-in-tree scheduler producer；
    - 若重新导出或开放 extension，须补 deadline/stability/max-batch 非法值测试。^[PR #5843]
- [DIFFADM-1d] pause keep 关闭 scheduling gate 并完成全 rank barrier
  - 触发：修改 diffusion pause/resume RPC、admission wait 或输出排空。
  - 强制：仅 request-level execution 支持 mode=keep；enqueue pause 即关闭 engine scheduling gate并打断 admission wait，ACK 在已运行 batch 的全 rank synchronize_device barrier 后返回。暂停期间继续 RPC/abort，已结束请求仍发 terminal output；当前 batch 输出/D2H/SHM 完成排空后再处理 pause 后的后续控制。resume 先打开 scheduling，再恢复上游 admission；定向 replica RPC 保留隔离。
  - 验收：覆盖 busy/idle/bootstrap pause、admission wait 竞态、RPC ordering、abort terminal、全 rank barrier 与 replica targeting；step execution/错误 mode 明确拒绝。 ^[PR #7685]

## 决策与踩坑

- [DIFFADM-1a] 禁止：在 Engine 重新编码 request scheduler 的 max-batch/stability 规则；对 step scheduler 默认等待；用 sleep 代替 condition wait；等待期间释放后不重新读取 scheduler 状态。
- [DIFFADM-1b] 禁止：serial capacity 仍付固定延迟；running wave 期间等下一批；把 DP 较长稳定窗应用到普通 request batching；把 `max_num_seqs>1` 当成 pipeline 自动支持融合——能力 gate 仍在 Engine init，DLO DP concurrency 是现有例外。
- [DIFFADM-1c] 禁止：只校验 `< 0`（`nan` 会穿透并令 condition timeout 退化成 hot poll）；只在 CLI 校验而放过 Python/config factory；重新公开 decision 却没有验证 finite deadline/stable window 和正 max batch。
- [DIFFADM-1d] 禁止：暂停期间调度新 wave；只同步 rank0 或只关前端 admission 就 ACK；让 abort terminal 等到 resume。
