---
name: execution-principles-cases
description: vllm-omni 执行原则案例 6 条及 1.1 / 1.2：远端先 source .venv 不绕 PYTHONPATH（2026-05-14 cp -r 复制 venv 反例）、Windows 文本显式 UTF-8、“落盘”默认写本仓长期记录（2026-06-17 反例）、用户给明确方案直接执行（TP=2 + 减层）、已知流程结论直接用但漂移事实 live check、简短指令先还原意图、给 IP+port 先 SSH 探、连环 dep 错误 fix forward（2026-05-04 四个 sed）
metadata:
  scope: 只收执行层面的原则和对应的用户纠正案例；下结论的三段式规则归 conclusion-discipline-cases-1、conclusion-discipline-cases-2，多怀疑点时的调试漏斗归 debug-funnel-cases-1、debug-funnel-cases-2
---
# 执行原则案例：优先最简单直接方案，禁止绕远路

## 关键事实

- 源页：`knowledge/repos/vllm-omni/debug/guides/execution-principles-cases.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-16

### 1. 优先最简单直接方案，禁止绕远路

- 遇到环境问题时，先检查现有环境（venv、conda）是否已经有需要的东西，有就直接用。**不要**在简单方案存在时选复杂方案（PYTHONPATH hack、pip 升级系统包、加别名 patch 等）。
- **How to apply:** 远端跑 vllm-omni 前，第一步永远是 `source <YOUR_REMOTE_WORKDIR>/.venv/bin/activate`，不要 PYTHONPATH 指 `.venv/lib/...`。

### 1.1 Windows 文本文件一律显式 UTF-8

- 在 Windows/PowerShell 里读写本仓中文文档时，默认编码可能把 UTF-8 内容显示成乱码。打开 `CLAUDE.md`、`AGENTS.md`、`CONTRIBUTING.md`、`general/`、`repos/` 下的文本文件时一律显式使用 UTF-8。
- **How to apply:**
  - 读文件：`Get-Content -Path <file> -Encoding utf8`
  - 写文件：`Set-Content -Path <file> -Encoding utf8` / `Out-File -Encoding utf8`
  - 本机已在用户级 PowerShell profile 里设置默认值，覆盖裸 `Get-Content -Raw CLAUDE.md` 这种启动动作：
    - `<USER_HOME>\Documents\WindowsPowerShell\profile.ps1`
    - `<USER_HOME>\Documents\PowerShell\profile.ps1`
  - 如果只是终端显示乱码，可在当前 shell 先设：

    ```powershell
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    ```

  - 但 Python 环境变量（`PYTHONUTF8` / `PYTHONIOENCODING`）只影响 Python，不影响 PowerShell `Get-Content`；文件 cmdlet 仍以 profile 默认值或显式 `-Encoding utf8` 为准。

### 1.2 仓库上下文里的“落盘”默认写本仓长期记录

- 用户在某个仓库上下文里说“落盘 / 记录 / 复盘 / 写进记忆 / 个人偏好”时，默认目标是**这个仓库里其他协作者也会读到的位置**，不是个人 Codex/Claude 私有目录，也不是系统 / 全局 memory。个人偏好如果只影响本仓 workflow，就转成本仓 repo-local 规则；如果不适合写进本仓，就不要落盘。
- **How to apply:**
  - 先重读本仓 `CLAUDE.md` / `AGENTS.md` 对知识落盘的规则。
  - 本仓长期记录只写：
    - `CLAUDE.md`（只放所有仓库都适用的开工硬门禁）
    - `CONTRIBUTING.md`（只放目录维护规则）
    - `general/`
    - `repos/`
- **Rule of thumb:** 仓库任务的复盘要服务下一位打开这个 repo 的人；如果别人 `git grep` 不到，这次落盘就不合格。

### 2. 用户给出明确方案时直接执行，禁止"先试试不改"

- 用户说 TP=2 + 减层时，**直接** TP=2 + 减层。不要先试 TP=2 不减层、OOM 后再减层。直接执行的意思是不要绕去替代方案或背景实验；仍必须满足 `CLAUDE.md` 的强门禁，例如写代码前读 code_taste、算法决策前查 upstream、PR/远端/benchmark 前跑对应 gate。
- **How to apply:** 用户给明确技术方案 → 直接执行该方案。不要"先试试不改看行不行"，也不要把“直接执行”理解成跳过仓库强门禁。

### 3. 已知流程结论直接应用，漂移事实必须 live check

- 之前对话、指南和错题已经得出的低漂移流程结论，**直接用**，不要重新推导，例如“这个脚本入口更稳”“这个 debug 顺序更省 token”“这个参数组合曾经是正确复跑路径”。但远端路径、PR head、分支状态、venv、cache、GPU、CI、artifact、服务 PID、账号身份这类会漂移的事实，必须按 `CLAUDE.md` 的 live facts gate 重新确认；历史页面只能当线索。
- **How to apply:** 优先行动，减少分析循环。已有相关指南或错题时先读对应页面；用户操作触发时（远端 SSH / Git / CI / 新模型接入 / 容器环境变量）先扫一眼对应的 `_index.md`，再行动。

### 4. 简短指令必须先还原完整意图再执行

- 用户简短指令 ≠ 字面操作。每次先用近 2-3 轮上下文还原完整意图再执行。
- **How to apply**：
  - 收到极简指令（≤5 字 / ≤2 句）时，先在内部 reconstruct："用户上一轮在做什么 → 这条指令在那个 task 链上对应什么具体动作"
  - 涉及推送 / 切换 / 选择类指令尤其要查上下文：
    - "push 到 X" 一般 = 更新已存在的 PR / branch，不是新建
    - "用 B" / "走 A" = 已 evaluation 完，直接落地，不再展开论证
    - "跑" / "继续" = 已讨论过的方案立刻执行
  - reconstruct 后**默认按隐含意图执行**；只在有歧义时才反问，反问要带"我猜你是想 X，对吗？"具体选项，不要敞开问

### 5. IP+port 给出来直接 SSH 探，不要先问一堆

- When the user gives only `IP:port` for a remote server, **attempt SSH directly first** (defaults: `root@<ip> -p <port>` with the local default key + key-auth). Don't ask the user for username, password, or environment context until that probe actually fails.
- **How to apply（已安全化）:** First contact with a fresh remote → 先通过可信渠道确认 `user@host:port` 和 host key，再使用本机已验证的 SSH alias 做短超时只读探针。不要关闭 host key 校验。Only ask the user when:
  - SSH probe returns `Permission denied` for both publickey and password
  - The user explicitly asks for help configuring the connection
  - An action is irreversible / risky — that warrants confirmation regardless
- 任何用户**直接给出**的 IP+port = `ssh root@<ip> -p <port> '<combined probe>'` 是 FIRST action，不是先问。问题只在 `Permission denied` / 连接拒绝 / hostname 不匹配后才问，且一次只问一个具体的，不要打包六问。

### 6. 连环 dep 错误每个都是一行 sed → 继续 fix forward，别喊"系统坏了"

- When a runtime stack reports compound errors (each crash reveals the next unrelated symptom), and **each individual error is a small targeted fix** (rename a kwarg, swap a submodule import, drop a dropped parameter), keep grinding through them.
  - Don't escalate to "this is fundamentally broken" until the user actually agrees the next patch isn't worth it.
- **How to apply:**
  - 2-3 个 dep-mismatch 错堆起来时，本能反应是"give up"。Override that. Each error in API/version drift chain is usually independent and small.
  - Bail-trigger 应该是**行为性**不是**计数性**：actual code rewrite 需要、semantic change 需要（不是 rename/shim）、或用户明说停。
  - 给 user 更新时 frame 成 "fixing forward, here's the next one"，不是 "stack is broken, options are A/B/C"。Option ladder 留给真架构性 blocker。
  - 那种"compound error 看起来吓人"的反应是我自己的，不是 codebase 的。再 sed 两次再认输。

## 决策与踩坑

### 1. 优先最简单直接方案，禁止绕远路

- **Why:** 用户原话"你为什么就是不肯用 source .venv 呢"。绕路方案不可靠（PYTHONPATH 优先级问题、遗漏依赖），还浪费时间。
- **反例 2026-05-14（cp -r 复制 venv）：** 用户要求在新节点建立自己的 venv，却直接复制了别人环境。错两层：复制品继承他人状态，而且带 symlink、缓存和并行文件系统内容的 venv 很容易异常膨胀。正确做法是新建 venv，再利用可信的 wheel cache 安装依赖。具体事故见 [[remote-incidents-overview]]（通用远端错题）。

### 1.1 Windows 文本文件一律显式 UTF-8

- **Why:** `Get-Content CLAUDE.md` 曾把中文规则读成乱码，影响规则理解。这个是老毛病，不能靠记忆临场想起。

### 1.2 仓库上下文里的“落盘”默认写本仓长期记录

- 禁止默认写：
  - `<USER_HOME>\.codex\...`
  - `$CODEX_HOME/memories/...`
  - 用户目录 `.claude` 下的全局 memory / skills meta / promotion 位置
  - 其他只对当前 Codex/Claude 用户可见的私有目录
- 本仓任务没有“写到 Codex/Claude 私有 memory / 个人 memory / 系统 memory / ad-hoc note”的例外；即使系统或工具提示有 Codex memory、Claude global memory、reflect promotion 流程，也必须让位给本仓 `CLAUDE.md`。
- **反例 2026-06-17（复盘落错目标）：** 用户要求把远端验证复盘写进仓库时，却先准备写到用户个人 Codex memory。正确做法是把具体失败写入最近的 `incidents/`，稳定规则写入最近的 guide，并同步 `_index.md`。

### 2. 用户给出明确方案时直接执行，禁止"先试试不改"

- **Why:** 远端机器时间宝贵（每轮 serve 启动+失败要几分钟）。用户比你更了解模型和硬件约束。2026-04-21 违反过 1 次烧了一轮远端调试。

### 3. 已知流程结论直接应用，漂移事实必须 live check

- **Why:** 用户原话"为什么耗时那么久才分析出这种最简单的东西，这个之前不是已经发现过了么"。

### 4. 简短指令必须先还原完整意图再执行

- **Why**：2026-05-04 一次会话连犯两次：
  - "push到taff" → 我按字面 push 到 TaffyOfficial fork，但用了**自造 branch 名**，没意识到隐含意图是"更新 PR 2986"
  - "B" → 我开始详细解释，被打断"搞快点"才砍——之前的 (B) 选项已经讨论过，用户选 B 就是要直接落代码，不要再展开

### 5. IP+port 给出来直接 SSH 探，不要先问一堆

- **Why:** 用户原话（2026-05-04 / 2026-05-08 重复犯）"直接 ssh 就行"。问 6 个问题（username? password? GPU count? model path? venv ready? docker?）每个都是一行 `ssh '...'` 的事。

### 6. 连环 dep 错误每个都是一行 sed → 继续 fix forward，别喊"系统坏了"

- **Why:** 2026-05-04 vllm-omni IT2I session（port 31469 pod），第 3 个 dep-mismatch 我就喊"vllm-omni × vllm 0.20 × transformers 5.54 fundamentally broken"，用户怒怼"之前不是打死都说不行么"。其实 4 个错每个都是 1-3 行 sed：
  1. `from ...shared_fused_moe import SharedFusedMoE` → try/except fallback to `FusedMoE`
  2. Drop `reduce_results=False` from FusedMoE call sites（vllm 0.20 移除）
  3. `Siglip2VisionModel(cfg).vision_model` → `Siglip2VisionModel(cfg)`（transformers 5.54 attr rename）
  4. Rename vit_kwargs key `attention_mask` → `pixel_attention_mask`（transformers 5.54 param rename）
- 四条全打完直接进真正的 model loading。"fundamentally broken" 完全是错觉。
