---
name: branch-push-rebase-1
description: "PR Workflow 第 0–1.1 节：主仓保持 main、只在 wt-* worktree 写文件的 hard stop guard，PR 分支改完自动 push（ruff、reviewer-lens 4-audit、DCO sign-off、Taffy 私有仓细节），reviewer follow-up 小修复快速通道（PR #4041）"
metadata:
  scope: 只收框架代码开工前的主仓/worktree 规则、自动 push 与 reviewer follow-up 快速通道；远端无写权限时的推送与按 PR head branch 名 push 归 branch-push-rebase-2，rebase 后语义复审归 branch-push-rebase-3，调试与对齐官方测试归 debugging-and-tests，入口路由归 pr-workflow
---
# PR Workflow · Branch / Push / Rebase（1/3）

## 关键事实

- 拆分说明：本页是源页 `branch-push-rebase.md` 的第 1/3 部分；第 2 部分 [[branch-push-rebase-2]]；第 3 部分 [[branch-push-rebase-3]]
- 源页：`knowledge/repos/vllm-omni/git/guides/branch-push-rebase.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#3626；#3766；#4041

### 机制入口

- 本页分两层读：
  - **通用机制**：开工前确认 git root / worktree、目标 PR head branch、DCO trailer、push remote、rebase 后语义复审。
  - **私有操作细节**：Taffy fork、`github-taffy` remote、历史 PR 事故和具体 sign-off identity 只在处理当前私有仓 PR 时复用；同步到公开版时只保留“使用 PR owner 指定身份和 remote，不自造 branch”。
- 执行顺序固定：
  1. 先确认这是新 PR、已有 PR follow-up，还是 rebase / cherry-pick 后更新 PR。
  2. 已有 PR 必须查真实 head branch，不用本地自造 branch 名推 fork。
  3. 写代码前确认是否在 `wt-*` worktree；主仓只做干净基准。
  4. commit 用 DCO sign-off；push 用 PR head owner 对应的可写 remote / SSH identity。
  5. rebase 或自动合并后，把冲突文件和 shared path 当 fresh diff 重审。

### 0. 框架代码开工前：主仓保持 main，只作干净基准源

- vllm-omni 框架的负责代码仓库在本机：

```powershell
$repo = "D:\vllm-omni\vllm-omni"
```

- 代码包入口是：

```text
D:\vllm-omni\vllm-omni\vllm_omni
```

- **Hard stop guard before any file write:**
- 在 `D:\vllm-omni\vllm-omni` 相关任务里，任何 `apply_patch` / 文件写入 / 格式化命令前先跑：

```powershell
$root = git rev-parse --show-toplevel
Split-Path $root -Leaf
git status --short --branch
```

- 如果输出的 git root 目录名不是 `wt-*`，禁止写文件。先新建 worktree，再把 cwd 切到 worktree。只读命令（`rg` / `Get-Content` / `git show`）可以在主仓跑；一旦要改文件，必须通过这个 guard。
- **How to apply:**
  - 主仓分支保持 `main`，不要在主仓切工作分支、不要在主仓写业务改动。
  - 开始框架代码工作前，在主仓同步 `origin/main`：

    ```powershell
    git -C $repo switch main
    git -C $repo fetch origin main
    git -C $repo pull --ff-only origin main
    ```

  - 如果主仓只是基准镜像、需要强制回到远端 main，也允许硬对齐（命令是 `--hard`，不是 `-head`）：

    ```powershell
    git -C $repo switch main
    git -C $repo fetch origin main
    git -C $repo reset --hard origin/main
    ```

  - 然后从 `origin/main` 或本地 `main` 开独立 worktree，命名 `wt-<purpose>`：

    ```powershell
    $wt = "D:\vllm-omni\wt-<purpose>"
    git -C $repo worktree add -b codex/<purpose> $wt origin/main
    ```

  - 后续所有编辑、测试、commit 都在 worktree 内做；主仓只负责保持 `main` 和作为 worktree 源。
  - 如果已经在主仓误写，立刻停手：记录 `git status --short`，用 `git diff -- <touched files>` 保存/迁移改动到新 worktree，然后只撤回自己刚造成的主仓改动；不要继续在主仓“顺手修完”。

### 1. PR 分支改完自动 push，不要等用户说

- When working on an existing PR/worktree branch, do not wait for the user to say "push" after finishing a code change.
- **How to apply:**
  - After implementing a requested PR branch change and passing reasonable local checks, commit or amend as appropriate and push automatically.
  - If the branch history was amended, use `git push --force-with-lease`, not a blind force push.
  - **动手前先跑 design-time 双 owner review**（reviewer_lens_gates（源链接 `../../../../general/review/guides/reviewer-lens-gates.md`））——非平凡业务改动在形成方案前开两个 sub-agent：module owner 评估模块 contract / edge cases / 测试矩阵，omni project owner 评估 repo 归属 / API surface / PR evidence。不要等写完再 “code check”；
    - 事后发现 P0/P1 说明方案 gate 放晚了。
  - **Push 前必跑 ruff，且必须在最后一次 edit 后跑** —— `ruff check <changed files>` + `ruff format --check --diff <changed py files>`，两条都要过。CI 用的就是 ruff/pre-commit，跑了 e2e 还栽在 lint/format 上太蠢。2026-05-15 PR `fix/hunyuan-image3-image-size` 上 CI 用 ruff format 把多行 `if` 拍成单行；
    - 2026-05-21 PR #3766 又因为最后一次 patch 后只跑了 `ruff check`/pytest/py_compile、漏跑 `ruff format --check`，pre-commit 红了一次。Anaconda Scripts/ruff 已在 PATH，直接 `ruff check ...` + `ruff format --check --diff ...` 几秒过；如果 amend 前又改了任何 Python 文件，重新跑这两条，不能沿用旧结果。
  - **Push 前必跑 reviewer-lens 4-audit**（reviewer_lens_audit（源链接 `../../../../general/review/guides/reviewer-lens-audit.md`），prompt 见 reviewer_lens_prompt（源链接 `../../../../general/review/guides/reviewer-lens-prompt.md`））——duplication / layering / edge cases / surface area，
    - 自己跑或开 sub-agent 都要用模板里那段 prompt，**禁用** "code check 一下" 类 framing。子 agent 答 "no issues found" 不能直接当通过，CLAUDE.md B33 兜底。PR #3626 没跑这步被 reviewer 4 条评论打回。
  - Keep using DCO sign-off for commits.
  - **Sign-off identity 机制**：DCO trailer 必须匹配当前 PR / fork 的提交身份；不要从联系人、CLAUDE 说明或远端登录用户脑补邮箱。
  - **本私有仓 Taffy PR 细节** (2026-05-15 起): `Signed-off-by: TaffyOfficial <2324465096@qq.com>`. 节点上 `git config user.{name,email}` 应该已经是这对——`git commit -s` 自动带上。**任何手写 trailer / PR 描述 / 给用户的引用文本里都用这个邮箱**，不要把 claudeMd 里的 `wu15922848573@outlook.com` 当 DCO 用（那是 user contact，不是 commit identity）。
    - 如果哪天发现 commit 实际 sign-off 用了别的邮箱（例如新节点 git config 没设），就 `git -c user.email=2324465096@qq.com -c user.name=TaffyOfficial commit --amend -s` 改回，再 force-with-lease 推。
  - If the user specified an SSH key or remote for the branch, keep using that key/remote for subsequent pushes.
  - Only stop before pushing if there is an unresolved test failure, a conflict, missing credentials, or a genuinely risky ambiguity.

#### 1.1 Reviewer follow-up 小修复快速通道

- **规则**：已明确的 reviewer follow-up 小修复走快速通道，不套完整 PR 出货流程。
- **触发条件**（全部满足）：
  - reviewer finding 已明确，或已被本轮 sub-agent/人工复核确认；
  - 本次修复 ≤3 个文件，且只处理已确认 finding；
  - 不新增 public API / CLI / extra args / multimodal key；
  - 不跨新 model owner，不做重构，不扩大 PR 行为面。
- **固定流程**：
  1. `gh pr view` / `git fetch <fork> <head-branch>` 先确认 PR 远端 head；如果远端已经包含修复，直接 no-op push 并汇报。
  2. 最小 edit + 最小 regression / repro；本地依赖缺失时只记录 blocker，不继续找多层替代证明。
  3. 跑 touched Python 文件的 `ruff check` + `ruff format --check --diff`。
  4. `git commit -s`，按 PR head owner 的指定 SSH remote push。

## 决策与踩坑

### 1. PR 分支改完自动 push，不要等用户说

- **Why:** 用户原话："自动push 不要我说"。

#### 1.1 Reviewer follow-up 小修复快速通道

- **事故**：2026-06-05 PR #4041 只需要修一个 masked `piecewise_attn` span-count P2 和一个 protocol type P3。我已经让 sub-agent 复核 finding 成立，代码改动也只有 3 个文件，但 push 前又机械套完整 PR 流程：二次 reviewer-lens audit、按整个 `origin/main...HEAD` 跑 scope gate、写全 PR ledger、等待 sub-agent，最后才发现远端 head 已经包含修复，`push` 只是 no-op。
  - 一个几分钟 follow-up 被拖成半小时。
- **禁止**：
  - 同一 finding 已有 sub-agent/人工复核后，再开 reviewer-lens audit 阻塞 push。
  - 对已有 PR 的小 follow-up 强行跑全 PR scope gate / 写全 PR ledger；只有本次 follow-up 扩大文件范围或触碰新 owner 才跑。
  - 用户明确说 `push` 时先补流程材料。先 push/确认 no-op push，再复盘流程问题。
