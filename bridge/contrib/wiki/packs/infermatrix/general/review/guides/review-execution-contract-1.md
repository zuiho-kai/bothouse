---
name: review-execution-contract-1
description: 独立审查执行合同（1/3）：何时使用、单次输入与简明检查单、60 秒渐进状态、Direct 并行与可预测验证、完成条件、默认一次审查与条件专项
metadata:
  scope: 只收独立审查执行合同的前半流程（输入采集、进度状态、并行证据轨、验证记录、三轮完成条件、单次审查与 10 分钟预算）；减法合同与输出格式见 review-execution-contract-2，内部审计模板与机器检查见 review-execution-contract-3
---
# 独立审查执行合同（1/3）

## 现状

- **何时使用：** 开发完成后的独立 review、完整 diff review、准备交给项目 owner 前的最后审查。
- 这里是默认 Direct 的单次审查入口；风险解释和专项 lens 只在首次审查留下具体高风险未知量时继续读取。
- 本页是源页的第 1 部分；第 2 部分 [[review-execution-contract-2]]（解释压力反查、触发式减法合同、用户可见输出、Reviewer 只读输入、Owner 怎样声明审查组），第 3 部分 [[review-execution-contract-3]]（内部审计 Markdown、机器检查、何时继续读取详细指南）。

## 关键事实

- 源页：`knowledge/general/review/guides/review-execution-contract.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-13；updated: 2026-10-02
- 来源：
  - InferMatrixCopilot Issue #17
  - InferMatrixCopilot Issue #24
  - vllm-project/vllm-omni PR #5871
  - zuiho-kai/claude-workflow-starter@c217fc6

### 单次输入与简明检查单

- 主审查只采集一次 `{base_sha, head_sha, PR title/body, changed files, diff, mergeability, CI}`。
- 元数据返回后先发宿主进度，再把 title/body/changed files 一次传给 Direct；使用返回的至多 3 个精确 owner/model `knowledge_routes` 内嵌 `quick_map`，同时消费 `related_knowledge` 中有界的解释性正文，核对来源 pin 与 PR head，缺失维度保留为未知。
- 截断背景只沿预算内的 `related_document_read_paths` 读取。
- 只有具体歧义阻塞源码审查时才打开完整规则文件，不得从总入口和索引重新导航。
- changed files 只验证和补全范围；PR 描述只负责导航，不能作为 finding 证据。
- 同一份证据包持续追加已读文件、caller 搜索、测试结果和 findings，后续步骤必须复用，不能重新抓取或重复调查。
- 第一次 Codex review 使用这份简明检查单：
  - 快速门禁：snapshot、mergeability、CI、完整 diff；
  - owner 路由：命中的 owner/model 规则组和第一批源码函数；
  - 行为合同：public ingress → producer → final consumer、默认值、fallback、兼容；
  - 验证合同：真实命中路径、相关测试、未验证边界；
  - 设计减法：越界 scope、重复 abstraction、最小 owner 设计。

### 60 秒渐进状态

- 审查开始后 60 秒内，快照元数据一返回，宿主就在任何知识读取、源码搜索或测试之前报告：
  - 固定的 head SHA；
  - 当前 CI 状态；
  - 当前可合并性；
  - 已有早期 finding，或明确写“暂未发现”。
- 早期 finding 必须标记为“初步”，宿主随后继续同一次审查。
- 该状态只用于避免用户长时间看不到进展，不是完整 review，也不是 GitHub 评论；不能发布“初稿评论”，最终仍只有一篇合并后的 review comment。
- CI 未完成或可合并性未知时报告真实状态，不等待它们完成，也不能先做知识导航再发进度。

### Direct 并行与可预测验证

- 固定快照后先让状态轨完成首次宿主进度，再并行推进其余证据轨：
  - **状态轨：** head SHA、CI、可合并性；首次元数据返回就发进度；
  - **知识/源码轨：** 只读 Direct 返回的精确 owner/model routes，然后进入首批源码、限定范围的 `rg` 和 caller；
  - **验证轨：** 先做 import/version 兼容性预检，通过后运行目标测试和低成本静态检查。
- 三条轨共用当前审查的一份证据包。
- 已读文件、搜索结果、caller、测试、repo-map、知识路由和 finding 不重复获取；搜索必须限定目录、glob 或输出量，不用无边界全仓递归扫描。
- Direct 不新增持久缓存、后台调度器或 progress API。
- CI 默认只作为状态证据；只有首个失败异常与 frozen diff 重叠或阻塞判决时才打开日志。
- 纯文档改动跳过依赖预检和 pytest，只做 diff hygiene、链接/构建检查以及对被引用 live contract 的有界核对。
- 远端 head 必须物化为隔离快照或只用 SHA-addressed read；detached worktree 只冻结身份，不是安全边界。
- fork/untrusted head 的 import、测试、build、hook 和 repo-configurable tool 只有在无 secret、限制文件系统/网络/资源且用后销毁的 sandbox 中才可执行，否则只做静态读取与已有 CI。
- 快照指纹必须覆盖 tracked、index、任务内 untracked 与 ignored bytes，并在每组可能改写文件的验证前后及交付前复核；只断言 `HEAD` 或只记录 untracked 文件名不足以证明证据未漂移。^[vLLM-Omni PR #5871]
- 验证记录必须包含 `{repo, head_sha, command, result, environment_fingerprint}`。
- 环境指纹至少覆盖依赖锁摘要、Python 和平台；只有依赖指纹匹配才复用环境。
- head 变化使旧测试结果失效，但依赖没有变化时不重建环境。
- 预检失败就报告具体不兼容项，不继续运行或声称 pytest 已验证。
- 预检通过后，目标测试和静态检查应与源码审查并行，不能等模型审完才启动。
- 每条变化语义已有 finding 或明确 no-issue 结论后停止，不为增加信心继续追加搜索。

### 完成条件

- 审查按以下顺序执行；减法轮由信号触发：
  1. **覆盖轮：** 冻结基线和完整 diff。
     - 先按 [[review-rules]]（通用设计审查规则）检查同族实现和条件分支的结构触发；命中时记录 `REV-1a`/`REV-1b` 的覆盖结论。
     - owner 定义审查触发组时，选择 `core` 加当前 diff 命中的组并完整枚举组内稳定 ID；没有触发组时才枚举该 owner 全部稳定 ID。
     - 随后填写当前可达公开入口和 changed-value producer→consumer 表。
  2. **条件减法轮：** diff 新增或扩张 helper、class、fallback、兼容分支或公共行为时，先按用户目标和当前 RFC/mini spec slice 删除越界 behavior、文件和测试；再枚举保留的 production abstraction，写出最小 owner 设计和逐项减法账本。
     - 没有这些信号时记录 `subtraction_signal=none` 并跳过。
  3. **开放轮：** 再查 correctness、duplication、layering、edge cases、surface area 和命中的专项风险。
- 规则覆盖表、入口矩阵和 producer→consumer trace 是 reviewer 的内部审计产物，不是默认给用户看的 review。
- 对外只交付已经证实、能落到具体代码位置的 actionable findings。

### 默认一次审查与条件专项

- 每次 PR review 只有一个主 Codex review，但必须在同一篇内部报告里覆盖两个维度：
  - **Correctness：** 追公开入口、producer→consumer、行为、兼容、默认值和测试。
  - **Design/subtraction：** 先删越界 scope，再查模块 owner、最小数据流、最小修改、既有复用和可删/并/内联/迁移的层。
- 只有主审查遇到新颖、证据矛盾或仍未覆盖的高风险合同，才允许追加一个有边界的专项问题；专项只读取共享证据包和完成该问题所需的新增源码，不重跑完整 diff，也不独立输出 verdict 或评论。
- 用户未指定深审时，端到端默认 10 分钟。到时停止新工具调用并返回现有结论；不能为完整 CI、全量测试、历史 thread 或额外专项无限等待。

## 决策与踩坑

- （完成条件）找到很多新问题不能代替覆盖轮或已触发的减法轮。
- （完成条件）任一轮发现 P0/P1/P2 都不能提前结束其他适用轮次。
- （完成条件）缺少所选规则行、可达入口或 changed-value consumer 时，结论只能是 `partial review`；减法信号已触发时，缺少 scope ledger、abstraction census、最小设计或证据也只能是 `partial review`。
- （完成条件）普通小修没有减法信号时不要求这些产物。
- （默认一次审查与条件专项）不能把两个维度拆成两篇通用审查。
