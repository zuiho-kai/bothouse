---
name: config-audit-plain-language
description: vLLM-Omni config audit 说人话规则：讨论 config/deploy/pipeline/cli cleanup 时先讲核心问题与 stage_0_runnre_cls 拼错示例，VOMNI-CFG-1a 至 1g 各组规则存在的原因，审查表 PASS/FAIL/MISSING_EVIDENCE 读法，五个问题展开、术语翻译与 P0 表达
metadata:
  scope: 只收向人解释配置审计问题的工作法与话术；配置语义（schema、合并链、默认值）归 configuration-overview 与 configuration-architecture，VOMNI-CFG 规则正文归配置规则页，最小证据收集归 config-normalization-parity
---
# vLLM-Omni config audit 说人话规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/config-audit-plain-language.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-09-02
- 来源（sources）：claude-workflow-starter-private@296ea45；PR #5647；vllm_omni/entrypoints/cli/serve.py；examples/online_serving/chart-helm/templates/_helpers.tpl

### 什么时候用

- 用户讨论 vLLM-Omni `config/deploy/pipeline/cli` cleanup、Unified `VllmOmniConfig`、diffusion config owner、deploy config / stage config 迁移时，先用会议室里所有人都能听懂的话解释问题，再补函数名和文件证据。

### 先说核心问题

- 不要先说“字段归属矩阵”“source of truth”“runtime payload”。
- 先说：

> 配置现在不是一个地方说了算，而是好几个地方都在改配置。

- 这些规则的共同目标只有一个：

> 同一份用户配置，不管从 CLI、YAML、legacy 入口还是默认 factory 进入，都应在真正
> 使用前得到同一个结果；拼错的字段不能在某条路径报错、在另一条路径却被静默吃掉。

### 一个具体例子

- 假设某个入口收到：

```python
{
    "stage_0_runner_cls": "MyRunner",
    "stage_0_runnre_cls": None,  # 拼错了
}
```

- 真实数据流不是“字典直接进 engine”，而是：

```text
CLI / deploy YAML / legacy / default factory
  → 合并来源、处理 alias、flat→nested
  → 检查每个 key 归谁
  → 按 shared / stage / diffusion 分区
  → 构造最终 config
  → engine / worker 消费
```

- 如果 CLI 会拒绝拼错的 `stage_0_runnre_cls`，但默认 factory 在校验前把值为 `None` 的未知字段删掉，那么两条入口表面都能启动，实际合同却不同。以后字段改名或 rebase 后，这种差异很容易变成“用户配置看起来被接受，运行时却没生效”的问题。

### 怎么读审查表

- `PASS`：当前证据证明这条合同成立。
- `FAIL`：已经有可达路径和失败行为，说明是真问题。
- `MISSING_EVIDENCE`：没有足够测试或运行环境证明它成立；这是证据缺口，不等于已经发现运行时 bug。
- `NOT_APPLICABLE`：当前 diff 没触发这条规则。
- `Disposition`：只是把失败或证据缺口链接到具体 finding / draft，不是新的结论。
- 这些状态和规则表只属于内部审计。对外 review 应转换成普通 GitHub inline comment：绑定具体文件和行，说明触发输入、当前行为、影响与最小修复方向。用户明确要求完整审计时，才附上规则表。

### 围绕五个问题展开

1. 入口太多。
   - `vllm serve --omni` 的唯一公开 YAML 入口是 `--deploy-config`。
   - `stage_configs_path` 只保留在 offline/programmatic API 和内部 resolver；serve CLI 会拒绝 `--stage-configs-path`。
   - 还有不传配置时的 diffusion fallback。
2. 默认 diffusion 配置有好几处在造。
   - factory 有逻辑。
   - engine 有逻辑。
   - CLI wrapper 也有逻辑。
   - 讲清楚问题是“以后默认值要改，到底改谁”。
3. 配置中途会被反复加工。
   - 用户写的配置不是直接拿去跑。
   - 中间会合并、转格式、补字段、规范化。
   - 所以光看 yaml 不知道最后 runtime 真正用了什么。
4. 新老配置路径混在一起。
   - `--deploy-config` 是 public serve 的唯一方向。
   - `stage_configs_path` 仍存在于 offline/programmatic 调用，不等于 public CLI 仍兼容。
   - 文档里出现 stage config 不一定都是错的：online serve 写法必须迁移，offline legacy-required 需沿真实入口确认；Helm 旧 key 必须明确报迁移错误，不能静默忽略。
5. 模型迁移和 runtime bugfix 容易混在一起。
   - pipeline registry 迁移应该讲 topology。
   - runtime bugfix 应该单独说明。
   - 不要让 reviewer 分不清这是配置清理还是模型行为修复。

### 术语必须翻译

- 字段归属 = 这个配置字段到底谁管。
- source of truth = 最终配置到底谁说了算。
- runtime config = 最后真正拿去跑的配置。
- topology = 模型有几个 stage、stage 怎么连。
- legacy-required = 现在还不能删，因为还有模型或测试真的靠它跑。

### P0 的人话表达

- 不要说“先产出字段归属矩阵”。
- 说：

> Stage 1 先不急着改代码。先搞清楚配置从哪里来、最后在哪里生效、哪些 legacy 还不能删。否则 cleanup 很容易删错字段，或者把模型运行行为改掉。

- 配置语义（schema、合并链、默认值）的 owner 见 [[components-overview]]（Configuration）；本页只管审计工作法。

## 决策与踩坑

### 每组规则为什么存在

- `VOMNI-CFG-1a`：先确认这次到底改了哪些入口和值状态，防止漏掉仍可调用的老入口，也防止把测试膨胀成无关的全排列。
- `VOMNI-CFG-1b`、`1e`：所有入口要在第一位真正使用者之前汇合到同一套归一化和校验；否则每个 factory 都会慢慢长出不同语义。
- `VOMNI-CFG-1f`：字段名是否存在与字段值是否有效是两件事。`None`、`False`、`0` 不能都靠 `if value` 处理，拼错且值为 `None` 的字段也不能逃过严格校验。
- `VOMNI-CFG-1c`：helper 单测只能证明 helper，不能证明 CLI、legacy 或默认 factory 真的调用了它，所以至少要有一条真实生产路径证据。
- `VOMNI-CFG-1d`：一个兼容修复如果开始新增 owner、来源优先级或路由，就已经变成另一个配置改造，应重新切片，避免评论驱动的补丁越滚越大。
- `VOMNI-CFG-1g`：rebase 可能新增字段却不产生冲突；旧白名单仍能编译，但会静默丢掉新字段，所以必须在最新 base 重新审计。
