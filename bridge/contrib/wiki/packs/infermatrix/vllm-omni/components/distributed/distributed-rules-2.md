---
name: distributed-rules-2
description: Distributed 传输规则（2/2）DIST-2a、3a、1k、1l、1l2、1l3、1l4、1m、VLLM-OMNI-PR9406-ASYNC-POLL-SLEEP：diffusion EP group 的 use_all2all、OmniRequestOutput msgpack 扁平 dataclass 兼容、mooncake-transfer-engine 0.3.12 起的 TCP write ACK、parked sender 终态先投 terminal chunk、NixlConnector 超时保留 native 资源与 lease、原生 Mooncake AR→DiT KV 须 async_chunk=False、SharedMemoryConnector 按完整 key cleanup、_wait_until 用 asyncio.sleep(0.001)
metadata:
  scope: 只收 DIST-2a、3a、1k、1l、1l2、1l3、1l4、1m 与 VLLM-OMNI-PR9406-ASYNC-POLL-SLEEP；DIST-1a 至 DIST-1j 见 distributed-rules-1，stage final 的 SHM 回收（DIST-FINAL-1a、1b）归 rules-shm-final-cleanup，SHM arrival wakeup（DIST-WAKE-1a）归 rules-shm-readiness
---
# Distributed 传输规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/2 部分；第 1 部分 [[distributed-rules-1]]
- 源页：`knowledge/repos/vllm-omni/components/distributed/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, distributed；created: 2026-08-05；updated: 2026-10-26
- [DIST-2a] diffusion EP group 必须满足运行中 MoE backend 的 communicator 合同
  - 触发：上游 MoE factory/oracle 或 `init_model_parallel_group` 增加 all-to-all manager 要求。
  - 强制：EP group 在运行版本支持 `use_all2all` 时显式启用；兼容旧版本用签名能力检测，不能按版本字符串猜测。非 EP group 保持原参数，避免扩大 communicator 行为。
  - 验收：mock 新旧签名分别断言 EP 转发/旧版省略，普通 group 不启用；目标环境用真实 MoE DiT TP+EP smoke 验证 manager 非空。^[PR #5976]
- [DIST-3a] Omni 输出序列化必须按扁平 dataclass 合同兼容旧线格式
  - 触发：修改 `OmniMsgpackEncoder`/`OmniMsgpackDecoder`、`OmniRequestOutput` 字段或跨 stage 输出 wire format。
  - 强制：当前 `OmniRequestOutput` 按其 dataclass 字段重建，不能落入基类 `RequestOutput` 的动态属性编码路径；decoder 只构造已知字段，并在旧 wire format 含嵌套 `request_output` 时完成一次向扁平对象的内容合并。基类 `RequestOutput` 的字段集合必须跟随 pinned upstream 合同。
  - 验收：msgpack round-trip 分别覆盖 pipeline 文本输出和 diffusion 图像输出，保持 request metadata、prompt、token、outputs、finished、stage 字段及图像内容；旧嵌套 wire payload 能解码为扁平对象，编码不递归且解码后的字段可被直接消费。^[PR #5146]
- [DIST-1k] Mooncake TCP write completion 必须表示目的端已应用
  - 触发：升级 `mooncake-transfer-engine`、修改 TCP `batch_transfer_sync_write`/completion 语义，或让零拷贝 consumer 在 write completion 后立即读取 destination buffer。
  - 强制：CUDA Mooncake 依赖必须钉在包含 acknowledged TCP writes 的版本（`0.3.12` 起）；`batch_transfer_sync_write` 返回成功后，destination 内存必须已更新到可读状态，不能只表示本地 send 入队。回归必须在 receiver 被挂起时证明 completion 不会提前返回，恢复后再断言目的端字节一致。
  - 验收：强制 TCP 的挂起-恢复测试覆盖「停止期间不完成、恢复后成功且字节匹配」；依赖声明与该测试同步变更。^[PR #7136]
- [DIST-1l] parked async-chunk sender 收到终态 update 必须先投递 terminal chunk
  - 触发：修改 `OmniSchedulerMixin.add_request`、`OmniChunkTransferAdapter.save_async` / sender cleanup，或 realtime/async-chunk 在 `WAITING_FOR_STREAMING_REQ` 上的终态竞态。
  - 强制：当终态 update（`resumable=False`）落在已 parked 且 `has_active_sender` 的 session 上时，不得只走 upstream 的本地 `FINISHED_ABORTED`。必须先 `force_request_finished` 入队携带 `finished` 的 request-terminal chunk（必要时推进 `_omni_segment_generation` 以通过 dedup），再本地 finish。
    - `terminal_pending` 必须挡住丢弃该 chunk 的 cleanup，直到 connector 接受。
  - 验收：覆盖 parked+active-sender 终态、非 sender/非 parked 回退、`force_request_finished` 顺序、terminal_pending 与 deferred cleanup；证明下游经 payload `finished` 结束，而不是仅靠 600s stall。^[PR #6889]
- [DIST-1l2] NIXL connector 超时后必须保留 native 资源直到终端态
  - 触发：新增/修改 `NixlConnector`、NIXL READ、ZMQ claim/`XFER_DONE`、lease 或 receive timeout。
  - 强制：NIXL 无远端 READ 取消时，超时/放弃后仍保留 buffer、registration、descriptor、transfer handle 与 remote agent，直到 native 终端态；`close()` 等待后再释放。源 registration 有界 lease（`lease_seconds` / `VLLM_OMNI_NIXL_LEASE_S`）并由 reaper 回收。跨 stage 请求须把 producer endpoint/`payload_sender_info` 经 scheduler handle 传到 consumer。
  - 验收：覆盖超时保留、lease 回收、metadata claim/ack，以及 `OmniChunkRecvHandle.payload_sender_info` 贯通；缺 NIXL 依赖时 lazy import 为 None。^[PR #6093]
- [DIST-1l3] NIXL ownership 与 metadata timeout 使用独立可控路径
  - 触发：修改 NIXL terminal/deferred ownership 测试、metadata claim/query 或 transfer wait。
  - 强制：ownership 用例使用 reliable_claim_queries 隔离短 ZMQ discovery，保留 metadata 编解码、claim 与 producer 状态机。metadata timeout 单测只对 metadata query socket 注入 zmq.Again，断言 get 返回 None、零 copy 且不登记未获得的 ownership；真实 handshake 仍单独跑 ZMQ roundtrip。
  - 验收：覆盖 direct 与 done/error/timeout/unknown ownership；timeout 与真实 handshake 各有独立断言，roundtrip 比较 tensor/size 和唯一 copy/ownership，清理 socket/thread。CPU core_model 门禁不能证明 NIXL DMA 硬件行为。 ^[PR #7870] ^[PR #7733]
- [DIST-1l4] 原生 Mooncake AR→DiT KV 必须关 async_chunk 并按物理页序释放
  - 触发：部署或修改 `kv_transfer_config`/`MooncakeConnector`、AR→DiT 原生 KV handoff、`OmniARScheduler` 的 block free，或与 legacy `OmniKVTransferManager` 并存的路径。
  - 强制：存在 stage `kv_transfer_config` 时必须 `async_chunk=False`。原生路径由 scheduler 拥有 diffusion KV 页；connector 失败 fail-close diffusion engine 后再拆页。非 caching P/D 池释放时按递增 `block_id` 归还，便于相邻页合并；deferred free 存逆序以匹配 vLLM drain。原生 transfer 边界用已确认 computed tokens，排除 async output placeholders；
    - 需要时短暂改写 request status/token 计数并在 `finally` 恢复。
  - 验收：配置拒绝 async_chunk+kv_transfer；物理序 free；confirmed-token transfer 边界；失败 fail-close。^[PR #7166]
- [DIST-1m] SHM producer 只能按完整 key 回收，并有界 reap 跨进程已消费段
  - 触发：修改 `SharedMemoryConnector` 的 `_pending_keys` / `cleanup` / `close` / `reap_consumed`，chunk adapter abort 后的 sender 清理，或 lock-file 与 `/dev/shm` 回收。
  - 强制：`cleanup` 按调用方传入的完整 key 精确 unlink，不得按 request-id 做 `_` 前缀/后缀模糊匹配；即使 key 不在 `_pending_keys` 中仍会尝试 unlink，不能把该记账集合当成所有权拒绝门禁。receiver 读到 SHM 字节后即可标 consumed 并删 lock file，即使随后 deserialize 失败。producer 在 `put` 与空闲 save loop 上做有界 round-robin `reap_consumed`（丢弃对端已 unlink 的 key）。
    - abort 后在 in-flight 排空再按 adapter 生成的精确 chunk key 入队清理；成功终态 payload 必须留给下游消费，且清理发生在 external-id 复用之前。receiver 用当前 registration identity 拒 stale work，不得堆积 cancellation tombstone。
  - 验收：覆盖相似 request id、abort-during-put、external-id 复用、无效 payload 后 lock 消失、consumed-key 回收，以及取消后 `/dev/shm` 与 pending keys 归零。^[PR #8082]
- [VLLM-OMNI-PR9406-ASYNC-POLL-SLEEP] stage memory 生命周期测试的 _wait_until 轮询禁止 sleep(0) 忙等
  - 触发：改动 `tests/engine/test_stage_memory_lifecycle.py` 中 `_wait_until` 轮询助手——`while not predicate()` 循环内的休眠间隔或外层 `asyncio.wait_for` 的超时取值。
  - 强制：`_wait_until` 的轮询必须以真实让出事件循环的休眠代替零延迟忙等，随 PR #9406（修复 #9401）合入的取值为 `await asyncio.sleep(0.001)`。依据随修复落在树内的代码注释：谓词的满足依赖 `asyncio.to_thread` 中执行的 replica 注册，`asyncio.sleep(0)` 的循环连续可运行，会在 GIL 上饿死该工作线程，使替换快照在期限耗尽前无法发布（PR 记录的单 CPU 绑定 + 加大线程切换间隔的压复现：修复前 1 failed/141 passed，修复后 220 passed）。
    - 修该文件此类时序 flake 时保持 `timeout=2` 与全部生命周期断言不变（含防止已脱离 RPC 覆盖其替换者快照的断言），调整的是轮询让出方式而非期限或断言。
  - 验收：`_wait_until` 循环内为 `await asyncio.sleep(0.001)` 且 `timeout=2` 未变；`python -m pytest tests/engine/test_stage_memory_lifecycle.py tests/engine/test_membership_controller.py tests/engine/test_stage_pool_collective_rpc.py -q` 通过。^[PR #9406]

## 决策与踩坑

- [DIST-2a] 禁止：创建普通 device communicator 后等 weight load 才触发 manager assert；向不支持该 kwarg 的旧 vLLM 无条件传参；把 TP/EP 配置存在当作 manager 已初始化。
- [DIST-3a] 禁止：让 subclass 走基类序列化而丢失 diffusion/stage 字段或形成递归；不得把未知 key 直接传给 `RequestOutput`/dataclass 构造器；upstream 已移除的 `multi_modal_placeholders` 不得仅为旧动态属性重新作为当前字段恢复。
- [DIST-1k] 禁止：降级到无 ACK 的 TCP 实现却不更新测试合同；把 RDMA 路径的 completion 语义外推到 TCP；或在 completion 前启动依赖 destination 内容的零拷贝消费。
- [DIST-1l] 禁止：假设 orchestrator 的一次性 StreamingUpdate 对下游 receiver 足够；在 `finish_requests` 之后才尝试 enqueue terminal；让 cleanup 在 terminal 上线前回收 generation，导致下游卡在 `WAITING_FOR_CHUNK` 直至输入超时。
- [DIST-1l2] 禁止：超时后立刻 deregister 或丢弃仍可能被 DMA 写入的内存；把 vLLM P/D block-table NIXL 接口当作 Omni 任意 payload connector；依赖未声明的固定 `zmq_port` 却不经 resolver。
- [DIST-1l3] 禁止：靠放宽 entered.wait 掩盖短 query 未进入 transfer；让 ownership fixture 悄悄屏蔽 metadata timeout，或删除真实 handshake。
- [DIST-1l4] 禁止：`async_chunk=True` 搭配原生 KV transfer；把 eviction-priority free 顺序当成无缓存池的物理布局；用含 placeholder 的 token 计数作为 transfer 边界；connector 失败后仍继续拆页当成功。
- [DIST-1m] 禁止：用 request-id 子串误删无关 SHM；把已跨进程消费的 key 永远留在 `_pending_keys`；deserialize 失败就留下 lock file；用 underscore-prefix 猜测所有权。
- [VLLM-OMNI-PR9406-ASYNC-POLL-SLEEP] 禁止：把 `_wait_until` 循环内的休眠改回 `asyncio.sleep(0)` 忙等；以拉长 `asyncio.wait_for` 超时或删除/放宽该文件生命周期断言的方式"修复"此类时序 flake。
