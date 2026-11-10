---
name: rules-graph-buffer-fixtures
description: "Graph 测试 buffer 规则 OMNI-CI-GRAPH-1a：CFM graph eager/replay oracle 的 fake estimator 未写输出区域必须用确定值初始化，不得以 torch.empty 尾部作 oracle（PR #8330）"
metadata:
  scope: 只收 CFM graph parity 测试中 synthetic estimator 输出 buffer 初始化这一条规则；一般的 fixture 生命周期与并行测试隔离归 rules-test-fixtures
---
# Graph 测试 buffer 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/rules-graph-buffer-fixtures.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, ci；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8330
- 置信度（confidence）：high
- [OMNI-CI-GRAPH-1a] fake estimator 未写的输出区域必须初始化
  - 触发：修改 CFM graph eager/replay oracle、fake estimator 或 cache-tail fixture。
  - 强制：synthetic estimator 只写 chunk 前缀时，其他会参与 parity 比较的 cnn/attention output 区域用确定值初始化；eager 与 graph 比较相同有效区域及定义好的 tail。
  - 验收：未写 tail 不含非有限值，模拟 estimator 遗漏写入时 oracle 稳定；独立真实 estimator 测试仍要检查历史 cache 的读写 ownership。^[PR #8330]
- 更一般的 fixture 生命周期查 [[rules-test-fixtures]]（CI fixture 规则）。

## 决策与踩坑

- [OMNI-CI-GRAPH-1a] 禁止：用 torch.empty 的未写尾部作为 oracle，让偶发 NaN/垃圾值形成 graph 数值回归；把 fixture 初始化等同于真实 model cache-tail 已验证。
