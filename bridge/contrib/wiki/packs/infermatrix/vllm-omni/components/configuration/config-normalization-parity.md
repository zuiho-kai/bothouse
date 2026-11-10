---
name: config-normalization-parity
description: 配置归一化与 parity 证据：最小矩阵（入口 × 值状态 × copy 边界 × consumer）、执行顺序、严格 schema 的 Normalize/Validate ownership/Partition/Construct 四步与值状态检查表、rebase 后 schema 刷新步骤、兼容修复滚成重构时触发 VOMNI-CFG-1d 的 stop signal
metadata:
  scope: 只收实现配置开发门禁时怎样收集最小证据和控制范围；字段所有权的解释方法归 config-audit-plain-language，完整配置路径归 configuration-architecture，stage runtime 严格配置约束归 model-executor-rules-1 至 model-executor-rules-3
---
# Config normalization parity

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/config-normalization-parity.md`（InferMatrixCopilot@ecfb84d0）；title: 配置归一化与 parity 证据；type: guide；tags: vllm-omni, components, config, review；created: 2026-07-16；updated: 2026-07-29
- 来源（sources）：claude-workflow-starter-private@296ea45

### 什么时候用

- 实现 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（配置开发门禁） 时使用。本页只说明怎样收集最小证据，不扩大审查范围。字段所有权的解释方法见 [[config-audit-plain-language]]（config audit），stage runtime 的严格配置约束见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor 规则）。

### 先写最小矩阵

- 只填写当前 diff 会改变的行，再加一个默认或相邻 control。入口、值状态和检查点是候选维度，不要求全部组合：

| 入口 | 本轮相关值状态 | 实际对象与 copy 边界 | 第一位 consumer | 最终 consumer | 期望 |
|---|---|---|---|---|---|
| deploy、`engine_extras`、nested config、CLI/runtime、direct factory 或默认 fallback 中受影响的一条 | 缺失、`null`、非默认值、冲突值或可转换标量中会改变分支的一项 | 哪个 dict/config 被原地修改，哪里复制 | preflight、validator 或 dispatcher | final config 或 worker | 保留值、派生值或错误 |
| 默认或相邻 control | 未受影响值 | 同上 | 同上 | 同上 | 行为不变 |

### 执行顺序

1. 先搜索 changed field 的现有字段集合、精确 schema 测试、constructor/factory 和 legacy/direct 入口。
2. 从入口追到第一位 consumer，记录每次 merge、copy、flat→nested 和类型转换；不要从最终 config 反推上游已经正确。
3. 在最早的共同边界实现归一化。ownership 校验先看 key 是否已知，再决定已知 `None` 是否丢弃；未知 `None` 仍按 strict contract 处理。
4. 回归测试至少穿过本轮真实入口和第一位 consumer，并再断言最终 config。helper 测试可以精确覆盖分支，但不能单独作为生产路径证据。
5. public dataclass/config schema 发生变化前，先检查现有精确字段集合、序列化和兼容测试。
6. 最后一次修改后实跑目标测试文件；本机缺 `vllm` 时立即切到已验证远端或 CI-like 环境，不能用 lint/compile 代替。

### 严格 schema 的固定执行顺序

- 完整配置路径见 [[configuration-architecture]]（配置构造架构）。实现时不得把下面四步折叠成“validator 顺手整理 kwargs”：
  1. **Normalize**：按 source priority 合并，再处理 alias、flat→nested、类型转换和 compatibility route。
  2. **Validate ownership**：对仍包含所有 key 的规范化映射检查 owner；此时未知 `None` 不能消失。
  3. **Partition**：只在校验通过后拆出 shared engine、stage、diffusion 或其他明确 owner 的 payload。
  4. **Construct**：typed config/factory 只消费已分区产物，不再维护另一套过滤、冲突或 fallback。
- 若 structured、legacy startup 或 direct factory 中任一路需要独立实现第 1 或第 2 步，先停止并寻找更早的共同 primitive；仅仅把重复逻辑改成不同 helper 名称不算统一 owner。

#### 值状态检查表

| Case | 预期 |
|---|---|
| absent | 使用 owner 默认值 |
| known `None` | 仅在 owner 声明 unset 时丢弃 |
| known `False` / `0` | 保留显式值 |
| unknown `None` | strict error |
| legacy value + canonical `None` | 提升 legacy |
| legacy value + canonical value | conflict error |

- 参数化矩阵只选择本轮会改变分支的行，但 unknown `None`、一个显式 falsey 值和一个合法非默认值是 strict config 变更的最低 control。

### Rebase 和上游 schema 变化

- rebase 成功、无冲突或 `range-diff` 看起来等价都不代表配置合同未变。上游新增字段可能让旧 allowlist、projection、default factory 或 owner 集合立刻过期；自动合并也可能只漏掉集合中的一个成员，却不产生语法冲突。
- 基线刷新后执行：
  1. 比较 base/head 的 public dataclass、typed projection、owner field set 和默认 factory 输入；
  2. 对新增字段明确 pipeline/stage/shared/diffusion/service/orchestrator owner；
  3. 搜索所有手写 whitelist，并优先替换为 schema metadata 或单一派生集合；
  4. 重新走 default factory、legacy startup、structured 和仍公开的 direct 入口；
  5. 在最新 base 的兼容 `vllm` 环境运行语义矩阵；旧 head 结果只能记为历史证据。

### 防止兼容修复滚成另一个重构

- 配置改动最容易失控的模式不是单个 helper 写长，而是按共同报错位置聚类 scope：strict validator 暴露一个兼容问题，就在当前 PR 顺手增加一种字段 owner；下一条评论再增加一种来源优先级；随后 structured、startup 和 direct 入口各自补特例，测试也按每个症状复制一遍。它们虽然都在同一个 validator 附近失败，实际改变的却是不同配置合同。
- 编码前为本轮目的写一句话边界，并给生产代码和测试写一个粗略量级。这个数字不是 KPI，只是 stop signal。出现下面任一情况时，先执行 `VOMNI-CFG-1d`，不能继续按评论逐条堆补丁：
  - 新修复要决定此前没有声明的字段 owner、输入来源或优先级；
  - strict validation 开始承担 parallel nesting、模型 extras 或服务字段迁移；
  - 同一语义需要在第二条入口重新实现，而不是复用共同边界；
  - 实现量级接近原预估的两倍，或测试开始按入口复制同一组断言。
- 重新切片时只回答三个问题：
  1. 这是不是原行为合同的必要部分；不是就拆成前置或后续改动。
  2. 是必要部分时，能否在第一位共同 consumer 前只实现一次。
  3. 测试能否写成“案例 × 入口”的参数化矩阵，再为每条真实生产路径保留一个集成 smoke。
- 通过信号不是测试数量，而是每个生产代码 hunk 都能由本轮一句话目的解释；删除任一入口特例后，参数化矩阵仍能证明各入口遵守同一个合同。
