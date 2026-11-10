---
name: connector-pitfalls
description: 三个已修的 connector/端口产品坑（2026-07-16 快照，rebase-agent @122a9468）：Mooncake put() 并发竞态致 MD5 不匹配（加 _put_lock）、Mooncake TCP 回退多写 0x01 协议字节致 msgspec.DecodeError（加垫 + 偏移重试）、OmniMasterServer 跨路由端口未去重致 flaky EADDRINUSE（_alloc_unique_ports 全局去重）
metadata:
  scope: 只收这三个坑的症状、根因、修法、验证与禁止项；后端矩阵与 connector 合同归 distributed-architecture，调度侧等待状态机归 scheduler-architecture，Mooncake TCP write completion 规则（DIST-1k）归 distributed-rules-2
---
# Connector 与端口分配已修产品坑

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/distributed/connector-pitfalls.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, distributed；created: 2026-07-16；updated: 2026-07-16
- 来源（sources）：vllm-omni-rebase-agent@122a9468:agent/skills/fix-mooncake-put-concurrency/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/fix-mooncake-tcp-deserialize-leading-byte/SKILL.md；vllm-omni-rebase-agent@122a9468:agent/skills/fix-omni-master-server-zmq-port-collision/SKILL.md

## 决策与踩坑

- 三个已根因闭环的产品坑，保留完整判定与修法。运营 runbook 以 rebase-agent 仓库为准，本页是知识树沉淀快照（2026-07-16，agent @122a9468；skills 工作树含未提交遥测更新，快照以工作树为准）。

### 1. Mooncake put() 并发竞态 → MD5 不匹配 / 数据损坏

- skill 元数据：`fix-mooncake-put-concurrency`，modules=[scheduler, distributed]，status=active，run_count=23，2026-06-12 创建 / 07-11 最后使用。
- 症状：`test_concurrent_put_get_integrity` 等并发 put/get 压测出现 MD5 mismatch 或断言失败，**非确定**（有的 run 过有的挂）；两次运行之间 connector 代码无改动。
- 根因：`MooncakeTransferEngineConnector.put()` 对同一实例的并发调用不是线程安全的。
- 修法：`__init__` 加 `self._put_lock = threading.Lock()`；把 put() 主体抽成 `_put_impl()`——**私有方法保持与 put() 相同的签名（仅去掉 from_stage/to_stage）**；put() 内 `with self._put_lock: return self._put_impl(...)`。
- 验证：并发压测通过；两条 import 检查—— `from vllm_omni.distributed.omni_connectors.connectors.mooncake_transfer_engine_connector import MooncakeTransferEngineConnector` 与 `from vllm_omni.core.sched.omni_ar_scheduler import OmniARScheduler`（调度模块传递依赖该 connector）。^[SK-fix-mooncake-put-concurrency]

### 2. Mooncake TCP 回退路径前置协议字节 → msgspec 反序列化失败

- skill 元数据：`fix-mooncake-tcp-deserialize-leading-byte`，modules=[scheduler, distributed]，status=active，run_count=15，2026-06-17 创建 / 07-11 最后使用。
- 症状：`test_mooncake_transfer_engine_rdma.py::TestEndToEnd::test_object_e2e` 报 `msgspec.DecodeError: MessagePack data is malformed: trailing characters (byte 1)`；仅 object（非 fast-path）传输失败，tensor/bytes/zero-copy fast-path 全过。
- 根因：Mooncake TransferEngine 的 TCP/memcpy 回退（`MC_STORE_MEMCPY`）在 `batch_transfer_sync_write` 时在有效载荷前**多写一个协议字节（0x01）**；接收端只按 `data_size` 读取，拿到 `0x01` + 前 `data_size-1` 字节；Decoder 把 0x01 当 fixint=1 消费，其余全成 trailing。
- 修法（`mooncake_transfer_engine_connector.py::get()`，两步）：
  1. 分配加垫：非 fast-path 时 `_MOONCAKE_TCP_PADDING = 4 if not is_fast_path else 0`；`alloc_size = data_size + _MOONCAKE_TCP_PADDING`；`offset = self.allocator.alloc(alloc_size)`；`recv_buffer = ManagedBuffer(self.allocator, offset, alloc_size, self.pool)`。
  2. 带偏移重试反序列化——先按 offset 0，**只捕获 `msgspec.DecodeError`** 再从 offset 1 重试：`payload = raw_bytes[:data_size]` → 失败则 `payload = raw_bytes[1:data_size + 1]`。
- 验证：`pytest -sv tests/distributed/omni_connectors/test_mooncake_transfer_engine_rdma.py` → **24 passed, 0 failed**。
- Watch out：垫片只作用于非 fast-path（序列化对象），fast-path（bytes/tensor/ManagedBuffer）不加；重试是防御式的（Mooncake 不加字节时 offset 0 就成功）；**若 Mooncake 上游修掉该协议字节，垫片与重试可移除**。^[SK-fix-mooncake-tcp-deserialize-leading-byte]

### 3. OmniMasterServer 跨路由端口未去重 → flaky EADDRINUSE

- skill 元数据：`fix-omni-master-server-zmq-port-collision`，modules=[online_serving, engine]，status=active，run_count=0，2026-07-10 创建/最后使用。
- 症状：多 stage 模型（Qwen3-Omni thinker/talker/code2wav）启动 flaky：`zmq.error.ZMQError: Address already in use (addr='tcp://127.0.0.1:<port>')`，包装为 `RuntimeError: Orchestrator initialization failed: Address already in use`；伴随 `Stage N replica M exited with code 1 before API server became ready`。
  - 同 commit 一个分片过、一个分片挂，重试即过；main 基线通过、rebase 分支 flaky。
- 判定要点（flaky vs regression）：先确认是端口竞争不是代码回归——查同 job 在并行分片/重试/main 基线上是否通过；集中出现在多 stage 模型上。
- 根因：每个 `(stage_id, replica_id)` 路由需要 3 个端口（handshake/input/output），由 `stage_engine_startup.py::OmniMasterServer._allocate_route_locked`（main @5c390096 为 :254）各自调一次 `get_open_ports_list(count=3)`（upstream `vllm.utils.network_utils`）；
  - 该工具只在**单次调用内**去重（bind 端口 0 → 读端口 → 关闭），跨调用时 OS 可能把刚释放的临时端口再次发回，两个路由拿到同一端口号，后 bind 的 engine 子进程 EADDRINUSE 退出。
- 修法（OmniMasterServer 全局去重，4 步）：
  1. `__init__` 加 `self._allocated_ports: set[int]`，**种子必须含注册端口 `master_port`，以及（若存在）从 `coordinator_router_address` 解析出的 coordinator ROUTER 端口**（两者已绑定在同一主机上）。
  2. 模块级 helper `_port_from_zmq_address(addr)`：从 `tcp://host:port` 提取端口；对 `ipc://`、`inproc://` 或无法解析的地址返回 `None`。
  3. `_alloc_unique_ports(count)`：从 `get_open_ports_list` 抽取，跳过已在 `_allocated_ports` 的端口，登记胜出者，碰撞重抽且**重试预算有界**——耗尽时 `raise RuntimeError`（绝不无限自旋）。
  4. `_allocate_route_locked` 中的 `hs_port, inp_port, out_port = get_open_ports_list(count=3)` 替换为 `self._alloc_unique_ports(3)`。
  - 残余限制：同机**无关进程**抢端口仍理论可能，但远更罕见且不在本服务控制内。
- 验证（CPU-only，无需 GPU/模型；skill 原文环境为 `cd /rebase/vllm-omni` 后用 `/rebase/.venv/bin/python`）：`/rebase/.venv/bin/python -m pytest tests/engine/test_async_omni_engine_stage_init.py -k "unique_route_ports or port_from_zmq" -q` →
  - 两条回归测试通过（`test_omni_master_server_allocates_globally_unique_route_ports` 用 monkeypatch 重复端口流 + master 端口，断言 3 个 stage 的 9 个路由端口互异且不等于 master 端口）；再整文件 `-q` 确认无回归（26 passed）。
- 禁止：把它当真实回归去改模型/生成代码（先查并行分片/重试/main 基线）；在 engine 子进程 `bind()` 外面套盲目重试（bind 地址与 connect 侧共享，重选端口需与 master 重新协调，必须在分配时修）；依赖 `get_open_ports_list` 跨调用全局唯一（它只在单次调用内去重）；重抽循环不设上限（端口耗尽要响亮失败而不是挂死）。^[SK-fix-omni-master-server-zmq-port-collision]

### 相关

- 后端矩阵与合同见 [[distributed-architecture]]（architecture）；调度侧等待状态机见 [[scheduler-architecture]]（Scheduler）。
