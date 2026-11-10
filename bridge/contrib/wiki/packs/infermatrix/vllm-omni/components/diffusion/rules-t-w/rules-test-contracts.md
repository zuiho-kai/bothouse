---
name: rules-test-contracts
description: "Diffusion 测试替身规则 DIFF-FIXTURE-1a、DVAE-MOCK-1：`_PipelineBackedEngine` 等 streaming executor 替身保留 is_dead 初值、failure callback 与 health-check 接口，类型收窄先绑定 dict.get() 再 isinstance（PR #8418）；Distributed VAE group coordinator mock 同时提供 cpu_group 与 device_group（PR #8591）"
metadata:
  scope: 只收 diffusion 测试中 executor 替身与 distributed VAE mock 须保留被实际代码消费的状态这两条规则；master_port 测试写法归 rules-master-port-tests，Wan SDPA 对齐测试的比较方式归 rules-wan-sdpa-math
---
# Diffusion 测试替身与类型契约

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-test-contracts.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-06；updated: 2026-10-09
- 来源（sources）：PR #8418；PR #8591
- 置信度（confidence）：high
- [DIFF-FIXTURE-1a] streaming executor 替身须保留实际消费的状态与类型
  - 触发：修改 `_PipelineBackedEngine`、executor liveness watcher 或 streaming output 测试的 payload/queue helper。
  - 强制：替身提供被实际路径读取的 `is_dead` 初值、failure callback 与 health-check 接口，保留已有 streaming 断言和 CPU collection。修复类型收窄时先绑定 `dict.get()` 结果再 `isinstance`，非 dict payload/metadata 仍返回空 dict；queue 构造的类型参数与其真实输出一致。
  - 验收：目标 streaming module 的 `core_model and cpu` pytest 与变更文件 mypy 门禁通过；若同时宣称死亡处理 coverage，另使替身进入死亡分支并断言 `DIFFUSION_PROC_DEAD` 与 teardown。^[PR #8418]
- [DVAE-MOCK-1] distributed VAE 替身提供实际被消费的 CPU group
  - 触发：修改 Distributed VAE batch/patch parallel 测试或 group coordinator mock。
  - 强制：当代码读取 cpu_group 时，mock 与 device_group 一同提供它；已有 CPU gloo WORLD 测试使用已初始化的 dist.group.WORLD，保留原 collectives 与分片数值断言。
  - 验收：目标 batch_parallel 和 Kandinsky patch-parallel 用例通过 CPU gloo 初始化、执行与 teardown；未运行的其他模块不宣称已验证。 ^[PR #8591]

## 决策与踩坑

- [DIFF-FIXTURE-1a] 禁止：遗漏 watcher 读取的属性；以删除 streaming 断言、改 CI 路由或跳过变更文件 mypy 解决 fixture 失败；由这次类型改写推断其他合法写法一概错误。固定 `is_dead=False` 只覆盖存活路径，不能证明 fatal teardown 已被测试。
- [DVAE-MOCK-1] 禁止：只模拟 device_group 让新 CPU collectives 报属性错误；以绕过 collective 或删除断言修 fixture。
