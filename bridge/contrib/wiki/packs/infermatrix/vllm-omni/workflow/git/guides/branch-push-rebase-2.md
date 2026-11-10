---
name: branch-push-rebase-2
description: PR Workflow 第 1.2–2 节：远端没 GitHub 写权限时用本机 github-taffy fork remote 与 git format-patch + scp 推送（不用 Set-Content 写 mbox），更新已有 PR 必须先查 head branch 名再 push（PR 2986 自造分支事故）
metadata:
  scope: 只收远端无写权限时的推送办法与按 PR head branch 名 push；主仓/worktree、自动 push 与快速通道归 branch-push-rebase-1，rebase 后语义复审归 branch-push-rebase-3，入口路由归 pr-workflow
---
# PR Workflow · Branch / Push / Rebase（2/3）

## 关键事实

- 拆分说明：本页是源页 `branch-push-rebase.md` 的第 2/3 部分；第 1 部分 [[branch-push-rebase-1]]；第 3 部分 [[branch-push-rebase-3]]
- 源页：`knowledge/repos/vllm-omni/git/guides/branch-push-rebase.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, git；created: 2026-07-10；updated: 2026-07-16

### 1. PR 分支改完自动 push，不要等用户说

#### 1.2 远端没 GitHub 写权限时，用本机已有 fork remote 推

- **症状**：远端 worktree 的 `origin` 是 HTTPS fork：

```text
origin https://github.com/TaffyOfficial/vllm-omni.git
```

- 直接 `git push` 报：

```text
fatal: could not read Username for 'https://github.com': No such device or address
```

- 改用 SSH URL 后又报：

```text
ERROR: Permission to TaffyOfficial/vllm-omni.git denied to deploy key
```

- **解法**：本机 repo 已配置 `github-taffy` 的可写 remotes（例如 `fork git@github-taffy:TaffyOfficial/vllm-omni.git`）。不要让远端凭据问题阻塞，改走本机干净 worktree：

```powershell
$repo = "D:\vllm-omni\vllm-omni"
$wt = "D:\vllm-omni\wt-push-i2t-smoke"
git -C $repo worktree add -B <branch> $wt origin/main
```

- 从远端导出目标 commit patch，必须用 `git format-patch` + `scp` 原样拷，不要用 PowerShell `Set-Content` 写 mbox：

```bash
ssh ... 'cd <REMOTE_WORK_ROOT>/wt-i2t-test-fix && git format-patch -1 --stdout HEAD > /tmp/fix.patch'
scp ... root@host:/tmp/fix.patch D:\vllm-omni\fix.patch
git -C D:\vllm-omni\wt-push-i2t-smoke am D:\vllm-omni\fix.patch
git -C D:\vllm-omni\wt-push-i2t-smoke push -u fork <branch> --force-with-lease
```

- **怎么避免**：
  1. push 前先跑：

     ```bash
     git remote -v
     ssh -T git@github.com
     gh auth status
     ```

     - 明确是 GitHub 写凭据还是只读 deploy key。
  2. 远端没写权限时，不要反复换 URL；切到本机已有可写 remote。
  3. 在本机原 repo 有未跟踪文件时，用独立 worktree 推，避免误带用户改动。
  4. `git am` 生成的新 commit hash 可能不同，但作者、message、DCO 和 diff 保持一致；PR 关注 diff 和 trailer。

### 2. "push 到 X 更新 PR Y" 必须查 head branch 名，不要自造分支

- 要更新一个**已存在的 PR**（不论自己的还是别人的），必须先查 PR head 对应 fork 上的实际 branch 名再 push；自造的本地 branch 名 push 到 fork = 在 fork 上新建 branch，**不会**更新原 PR。
- **How to apply**：
  - 用户说"push 到 X fork 更新 PR Y" / "push到taff" / 类似语境 = 操作目标是更新 PR Y，不是新建 branch
  - 执行前查 PR head branch 名：

    ```bash
    git fetch <remote> pull/<PR>/head:pr-<PR>          # 拿到 PR head commit
    PR_COMMIT=$(git rev-parse pr-<PR>)
    git ls-remote <fork-remote> | grep "$PR_COMMIT"     # 找 fork 上指向同 commit 的 refs/heads/<name>
    ```

  - 把当前 commit push 到 `<fork-remote> <commit>:refs/heads/<那个 name>`，**不要**用本地 branch 名直接 push
  - fast-forward push 到别人 PR head 是 OK 的（保留作者 commit + 我的增量）；force-push 才需要确认

## 决策与踩坑

### 1. PR 分支改完自动 push，不要等用户说

#### 1.2 远端没 GitHub 写权限时，用本机已有 fork remote 推

- **根因**：远端机器的 GitHub SSH key 是 deploy/read key，能 `ls-remote`，不能 push；远端也没有 `gh` 登录态或 credential helper。之前能 SSH 到远端不等于远端能 SSH push GitHub。
- **为什么不能用 `Set-Content`**：PowerShell 可能加 BOM / 改编码，`git am` 会报 `Patch format detection failed`。`scp` 保留原始 mbox 字节。

### 2. "push 到 X 更新 PR Y" 必须查 head branch 名，不要自造分支

- **Why**：2026-05-04 用户让 "push到taff"（语境：更新 PR 2986，作者 TaffyOfficial）。我用本地自造 branch 名 `feat/hunyuanimage3-i2t-ar-prefix-ci` push 到 `fork` remote，结果在 TaffyOfficial fork 新建了一个无人认领的 branch，PR 2986 完全没更新。
