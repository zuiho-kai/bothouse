---
name: agent-loop-workflow-1
description: Agent loop / sub-agent workflow（第 1/2 部分）：是否拆 agent、最小委派合同、所有权与证据、独立审查只由一个负责人安排、审查按波次收敛
metadata:
  scope: 只收多 agent 分工、委派合同、写入所有权、独立审查的安排与波次收敛；耗时记录、框架规则验收、维护者审查闭环和停止条件归 agent-loop-workflow-2，review prompt 怎样避免注入偏见归 review-delegation-framing
---
# Agent loop / sub-agent workflow（第 1/2 部分）


## 现状

- **何时来翻**：用户明确要求 sub-agent / 并行 agent，或任务能拆成互不依赖的调查面。目标是降低等待和盲区，不是增加流程。

## 关键事实
- 源页：`knowledge/general/agents/guides/agent-loop-workflow.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, agents；created: 2026-07-10；updated: 2026-07-30
- 来源（sources）："InferMatrixCopilot Issue #24"、"zuiho-kai/claude-workflow-starter@c217fc6"
- 本页是源页 `agent-loop-workflow.md` 的前半部分（“是否使用”到“所有权与证据”）；后半部分（“开发阶段耗时记录”到“停止条件”）在 [[agent-loop-workflow-2]]。

### 是否使用

- 适合使用：
  - 多个代码路径、日志、artifact 或外部来源可以独立核对。
  - 高风险 review 需要一个不继承主 agent 结论的只读视角。
  - 长任务中有独立的验证、资料整理或兼容性调查可以并行完成。
  - 非琐碎开发完成后，需要一个没参与实现的 reviewer 做交付前全量审查。
- 默认不用：
  - 单文件小修、明确 reviewer follow-up、短解释或单条命令。
  - scope 尚未收敛，拆分只会复制混乱。
  - 多个 agent 会修改同一批文件，或子任务结果必须逐步依赖前一步。
- 上面的“默认不用”只限制实现阶段是否拆分工，不豁免非琐碎开发完成前的独立审查。明确 reviewer follow-up 可以由一个开发 agent 修，但修完仍要由没参与修复的视角复审当前完整改动。
- 不按文件数、步骤数或模型名称强制开 agent；由任务是否真的可独立决定。

### 最小委派合同

- 委派只需说明五件事：

1. 目标和范围。
2. 只读还是允许写入；允许写入时独占哪个目录或 worktree。
3. 需要返回的证据，例如文件行号、命令、日志或 artifact。
4. 哪些决定仍由主 agent 保留，例如扩大 scope、公开回复、commit 和 push。
5. 谁负责启动交付前独立审查。没有明确转交时，由发出委派的父 agent 负责，开发 sub-agent 不自行再拉 reviewer。

- 不要把未经验证的 root-cause 猜测写成子任务结论。可以限定对象，不能要求“证明 X 就是原因”。
- 主 agent 已用 live 证据确认开发 owner 时，委派合同直接附上 `根入口 + code taste + 仓库硬门禁 + owner 命中规则 → 第一批源码函数`。
  - sub-agent 只读这些精确段落一次，然后从源码开始；不再读 discovery 索引、未命中的 planning/review guide 或同级 owner。
  - 只有实验目标本身是测量路由发现能力时才故意省略这份开发包，并在结果中把路由时间单独计算。

### 所有权与证据

- 只读 agent 可以共享 checkout；写入 agent 必须隔离目录、worktree 或明确文件所有权。
- 公共 PR body/comment、commit、push、merge 等外部动作只有一个 owner。
- 主 agent 必须复核关键引用；sub-agent 的 `OK` 不能替代测试、live diff、benchmark 或 artifact provenance。
- 子任务发现相邻问题时先作为 out-of-scope note 返回，不顺手扩大当前任务。

#### 独立审查只由一个负责人安排

- 每个基线和当前完整 diff 只能有一个 agent 负责安排独立审查。开发任务由父 agent 委派时，默认由父 agent 负责；只有委派合同明确写明“开发者负责审查闭环”时，开发 sub-agent 才能启动 reviewer。根 agent 自己开发且没有上层调度者时，由根 agent 负责。
- 父 agent 负责审查时，开发 sub-agent 完成实现、最小验证和反证扫描后立即记录 `AUTHOR_COMPLETE`，返回 diff、测试、未验证边界和自发现问题，并标记“待父 agent 独立审查”。它不得读取完整 review guide、生成正式 review report、启动嵌套 reviewer，或等待 reviewer 后再改写 author 完成时间。
- 审查负责人只启动一次主审查。先冻结输入，用 PR title/body 路由精确 owner/model 规则组，再一次性解析 changed files；同一份文件、caller、测试和 findings 证据同时服务 correctness 与 design/subtraction，不能拆成两篇通用审查。
- 只有主审查留下新颖、矛盾或未覆盖的高风险合同，并能说清一个有边界的问题时，才增加只读专项 reviewer。专项复用共享证据包，只补必要增量，不重跑完整 diff，不独立发布 verdict 或评论。
- reviewer 提出问题并发生代码修改后，仍由同一个审查负责人安排复审当前完整 diff。所有 checker、review report 和最终 clean 判定也由审查负责人负责，不下沉给开发 worker 重复执行。

#### 审查按波次收敛，不按评论串行打补丁

- 同一冻结基线的主审查和条件专项属于一个审查波次。除可立即证明会造成数据损坏、安全问题或错误公开操作的 P0 外，主 agent 必须先收齐已启动的专项结果再开始修改，避免后到证据审查已经过期的 diff。
- 主 agent 先按“被违反的 owner 不变量”合并 findings。两个以上 finding 指向同一语义在不同入口、stage 或 adapter 重复解析时，判定为一个合同边界失败：先补来源 × consumer scope 决策矩阵和唯一 owner 产物，再修所有路径；禁止把每条评论各加一个条件分支。
- 同一批文件只能有一个写入 owner。并行 agent 默认只读发现问题；“谁发现谁修”只适用于文件所有权互不重叠、测试可独立验证的子任务，不能让多个 agent 同时修改共享 dispatcher、schema、normalizer 或测试基类。
- 修复完成后由原审查负责人针对新完整 diff 发起一次复审。若复审再次出现两个以上同类新 finding，不进入第三轮逐条修补；退回合同矩阵，指出遗漏的 source、scope 或 consumer，再重新实现。
- 用户明确要求立即 push 时，不再启动新的开放式审查波次。先处理当前已知 P0/P1、运行与改动相称的最小验证并 push；已经启动的 reviewer 只允许交回当前结果，不能借“再保险”扩大 scope。仍有已知 P0/P1、测试失败或远端漂移时必须明确报告，不能用这条规则绕过安全阻塞。
- 用户没有指定深审预算时，交互式 PR review 默认端到端最多 10 分钟，条件专项共享这段预算。截止时审查负责人停止新工具调用并返回现有 finding、减法账本和未验证边界；不能继续等待完整外围验证。只有用户明确要求继续深审，才启动下一段有界预算。
