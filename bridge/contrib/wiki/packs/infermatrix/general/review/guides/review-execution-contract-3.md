---
name: review-execution-contract-3
description: 独立审查执行合同（3/3）：内部审计 Markdown 模板（Review report）、OWNER RULE COVERAGE / GROUPS 尾签与 Disposition 写法、legacy 规则页、check_review_report.py 机器检查、何时继续读取详细指南
metadata:
  scope: 只收独立审查执行合同的内部审计 Markdown 模板、覆盖尾签与 legacy 写法、机器检查脚本用法和后续详细指南入口；审查流程见 review-execution-contract-1，减法合同与输出格式见 review-execution-contract-2
---
# 独立审查执行合同（3/3）

## 现状

- 本页是源页的第 3 部分，接 [[review-execution-contract-1]]（何时使用、单次输入、60 秒渐进状态、Direct 并行、完成条件、默认一次审查）和 [[review-execution-contract-2]]（解释压力反查、触发式减法合同、用户可见输出、Reviewer 只读输入、Owner 怎样声明审查组）。

## 关键事实

- 源页：`knowledge/general/review/guides/review-execution-contract.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, review；created: 2026-07-13；updated: 2026-10-02
- 来源（sources）见 [[review-execution-contract-1]]：InferMatrixCopilot Issue #17；InferMatrixCopilot Issue #24；vllm-project/vllm-omni PR #5871；zuiho-kai/claude-workflow-starter@c217fc6

### 内部审计 Markdown

- reviewer 或审查负责人把下面内容保存为内部 Markdown，供 checker 检查覆盖完整性。
- 模板里的二级标题在源页以 `## ` 顶格书写；本页为通过 lint 在每个二级标题前加了一个空格，使用模板时去掉该空格。

```markdown
# Review report

 ## Review scope
- Base SHA: <sha>
- Diff: <base -> working tree or head>
- Owners: <rules paths or none>
- Rule groups: <rules path> = core,prompt-token[,other-triggered-group]；owner 没有组时写 `full`
- In-scope untracked files: <files or none>

 ## Owner rule audit
| Rule ID | Status | Evidence | Disposition |
|---|---|---|---|
| ABC-1a | PASS / FAIL / MISSING_EVIDENCE / NOT_APPLICABLE | file:function + test/run evidence | `-` / `FINDING:F1` / `DRAFT:blocked evidence` |
| LEGACY:path/to/rules.md#1 | PASS / FAIL / MISSING_EVIDENCE / NOT_APPLICABLE | quoted source unit + file/function/test evidence | `-` / `FINDING:F1` / `DRAFT:blocked evidence` |

 ## Public ingress matrix
| Ingress | Actual dispatcher | Contract check | First expensive operation | Owner adapter/consumer | Production-path test/evidence |
|---|---|---|---|---|---|
| <offline/API/chat/internal entry> | `<real function reached from the public entry>` | <validation/normalization and location> | `<decode/load/GPU/VAE call>` | `<actual adapter or bypass>` | <evidence> |

 ## Producer-consumer trace
| Value or contract | Producer | Transformations | Final consumer | Stop/failure owner | Evidence |
|---|---|---|---|---|---|
| <field/behavior> | <source> | <every handoff> | <actual reader> | <boundary> | <evidence> |

 ## Subtraction audit
### Scope ledger
| Behavior / production file / test group | Authorized goal or current RFC slice | KEEP / DELETE / DEFER | Evidence |
|---|---|---|---|
| <item> | <merge condition or none> | <decision> | <contract anchor> |

### Abstraction census and minimal design
- Current census: <every helper/class/field group/projection/artifact/compensation flow>
- Minimal owner design: <least owner artifacts, transformations and consumers>

### Item ledger
| Current abstraction | KEEP / INLINE / MERGE / MOVE / DELETE | Code anchor | Survival proof or removal |
|---|---|---|---|
| <item> | <decision> | <path:symbol> | <reason> |

### Net result
- Scope subtraction: <behaviors/files/tests removed or zero with proof>
- Architecture subtraction: <net abstraction/owner/projection/compensation/branch counts>

 ## Source-consumer decision matrix
| Source | Consumer scope / dispatcher | Decision | Conflicts with | Production-path evidence |
|---|---|---|---|---|
| <root/nested/alias/per-stage/default source> | <specific stage or consumer> | ROUTE / REJECT_DUP / NOT_APPLICABLE / DEFAULT | <specific sources or concrete reason no conflict exists> | <test/run evidence> |

只有能够证明当前 diff 不存在多来源、多 dispatcher、多 stage 或兼容入口时，本节才可使用 N/A；仍须保留表头，并在唯一数据行的每个单元格写具体理由，第一格以 `N/A-with-evidence:` 开头。一个 source 有多个 consumer scope 时分行写，不能在一个单元格里用“视情况”概括。

 ## Open findings
- `P0 F1` / `P1 F2` / `P2 F3` or `none`. Blocking finding uses one machine-readable line:
  `- P1 F1 — DIFF:<changed hunk>; PATH:<reachable runtime path>; CONTRACT:<pre-existing source>; FAILURE:<user-visible break>; COUNTEREVIDENCE:<canonical alternative checked>; FIX:<smallest safe fix>`
- 没有完成这六项证明的架构怀疑写 `NOTE N1`，不计入 P0/P1/P2，也不能映射成 owner `FAIL`。

 ## Completion
OWNER RULE GROUPS: <rules path>: core,prompt-token[,other-triggered-group]；owner 没有组时不写
OWNER RULE COVERAGE: <rules path>: X/Y stable IDs inventoried — A pass / B fail / C missing evidence / D not applicable
SUBTRACTION VERDICT: PASS / FAIL / PARTIAL — <scope and architecture result>
CORRECTNESS VERDICT: PASS / FAIL / PARTIAL — <findings or clean evidence>
AUDITS RUN: coverage,ingress,producer-consumer,source-consumer,duplication,layering,edge-cases,surface-area — N findings (Pa P0, Pb P1, Pc P2)
```

- 每个稳定 ID owner 各写一行 `OWNER RULE COVERAGE`。
- owner 的 `rules.md` 包含“审查组”表时，`Completion` 必须写一行 `OWNER RULE GROUPS`，至少选择 `core`；覆盖分母是所选组去重后的稳定 ID 数，不是整页总数。
- 未定义组的 owner 保持全量覆盖。
- `PASS` / `NOT_APPLICABLE` 的 Disposition 写 `-`；`FAIL` 必须写 `FINDING:F<number>` 并指向已完成六项证明的正式 finding；`MISSING_EVIDENCE` 必须写 finding，或用 `DRAFT:<具体且可核对的依赖、测试或 artifact 阻塞>` 说明为什么只能作为 implementation draft。
- 多个规则可以指向同一个 finding，不能从失败行里随意挑几个上报；每个 finding 也必须反向被规则行引用，只有紧跟 F ID 的 `OWNER_RULE:NONE` 新问题例外。
- 旧规则页没有稳定 ID 时传 `--legacy-rules`，按文件顺序给每个项目符号、普通段落和 Markdown 表格数据行写一行连续编号的 `LEGACY:<rules path>#N`，尾签写：
  - `OWNER RULE COVERAGE: <rules path>: X source units inventoried — A pass / B fail / C missing evidence / D not applicable — legacy-unstructured, no exact clause-coverage claim`。
- 脚本只核对这些机械源单元是否齐全，不宣称能把一个自然语言段落自动拆成精确子句。
- 完全没有 `rules.md` 时在规则表写 `OWNER RULES: none`，尾签写 `OWNER RULE COVERAGE: none: 0/0 stable IDs inventoried — 0 pass / 0 fail / 0 missing evidence / 0 not applicable`。
- 其他表仍要完成；只列当前 diff 可达入口和 changed values。
- 完全不适用时使用 `N/A-with-evidence: <至少二十字具体原因>`，每个单元格都给出具体解释，不能用 `-`、`none`、`unknown` 填充。
- 正常入口的 dispatcher、第一处昂贵操作和 owner consumer 用反引号写真实代码路径。

### 机器检查

- 把 reviewer 输出保存为 Markdown 后运行：

```powershell
python tools/check_review_report.py --report <review.md> --rules <stable-owner-rules.md> --legacy-rules <legacy-owner-rules.md>
```

- 多个 owner 重复传 `--rules`。
- 脚本检查规则组选取、组内 ID 完整性、必需章节、失败行到六项 finding 证明的映射、具体 draft 阻塞、入口 dispatcher→昂贵操作→owner consumer，以及完成尾签；它不判断触发组是否选对或证据真假，主 agent仍需抽查。
- 最终交付前增加 `--require-clean`，同时拒绝所选 owner 规则中的 `FAIL` / `MISSING_EVIDENCE` 和非零开放 finding。
- 结构通过后，主 agent仍要抽查关键文件/函数证据。

### 何时继续读取详细指南

- 需要完整可粘贴 prompt 或专项 owner 角色：[[reviewer-lens-prompt-1]]（reviewer lens prompt）
- 涉及 async、资源生命周期、性能证据或 rebase：[[reviewer-lens-gates-1]]（reviewer lens gates）
- 需要理解四类开放审查方法：[[reviewer-lens-audit-1]]（reviewer lens audit）
- public API、跨阶段字段或协议矩阵：[[reviewer-lens-contracts]]（reviewer lens contracts）

## 决策与踩坑

- （内部审计 Markdown）除非用户明确要求完整审计，不要把它原样粘贴到 GitHub review 或聊天回复。
- （机器检查）脚本失败时，主 agent 只把缺失项退回原 reviewer 补齐，不重新 framing，也不接受“已经找到足够多问题”。
