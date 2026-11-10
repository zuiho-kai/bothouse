---
name: 2026-05-29-git-and-pr-branch-pollution-10
description: "2026-05-29 错题：PR #3626 评论贴了绑定旧 head 9e2181430 的 image_online.png，并泄露 Artifact source 内部远端路径；删路径、rebase 重跑 online accuracy、用 headRefOid 与 run WT/HEAD 对齐的 provenance gate"
metadata:
  scope: "只收 2026-05-29 PR #3626 图片证据复用旧 head 且泄露内部 artifact path 这一起事故；PR 描述渲染问题归 2026-05-20-git-and-pr-branch-pollution-04，公开 PR 文本隐私规则归 pr-body-privacy"
---
# 2026-05-29 — PR #3626 图片证据复用旧 head，且公开评论泄露内部 artifact path

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-29-git-and-pr-branch-pollution-10.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-29-git-and-pr-branch-pollution-10`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：PR #3626 图片证据复用旧 head，且公开评论泄露内部 artifact path
- 影响范围：repos/vllm-omni/git
- **症状**：
  - Reviewer 要求补贴 online accuracy 的 output image。
  - 我从远端旧 artifact 拉取 `image_online.png`，验证它是 `PNG 1280x720` 后直接上传并贴到 PR。
  - 评论里还写了：

    ```text
    Artifact source: <REMOTE_WORK_ROOT>/wt-pr3626-accuracy/tests/e2e/accuracy/artifacts/HunyuanImage-3_0-Instruct-online/image_online.png
    ```

  - 用户指出这行不该出现；随后又要求 rebase 最新主干后重跑。
- **根因**：
  - 判断标准错了：把任务当成“补一张图片”，而不是“给当前 PR 状态补一组 reviewer-facing 证据”。
  - 只验证 artifact 本身存在、能打开，没有验证它和当前 PR head / base / metrics 是同一轮。
  - 当时旧 run 绑定的是 `9e2181430...`，而 PR head 已经发生变化；这种 mismatch 应该是 hard stop。
  - 把内部执行追踪路径当成透明度信息写进公开 comment。远端 `/data/...` 路径对 reviewer 没复现价值，只会污染 PR 页面并暴露环境细节。
- **正确补救**：
  1. 立刻编辑评论，删除内部 artifact path，只保留图片。
  2. 按用户要求 rebase PR branch 到最新 `origin/main`，force-with-lease 推回 Taffy PR branch。
  3. 远端 worktree 同步到新的 PR head 后重跑 online accuracy。
  4. 用新 run 生成的新图片、新 metrics、新 head 重新发干净 PR comment。
  5. 清理本次 run 遗留进程，确认 4/5/6/7 释放。
- **怎么避免**：
  1. PR comment/body 贴测试图或指标前先跑 evidence provenance gate：

     ```powershell
     gh pr view <PR> --repo vllm-project/vllm-omni --json headRefOid,headRefName,headRepositoryOwner
     ```

     ```bash
     cat <status-file>
     grep -E 'HEAD=|WT=|EXIT_STATUS|1 passed|\\[ONLINE\\]' <log-file>
     stat <output-image>
     ```

     - `headRefOid`、run `WT/HEAD`、图片 mtime/size 必须属于同一轮。
  2. `headRefOid != run HEAD` 时，不能贴旧 artifact。用户说 latest / rebase 后 / current PR 时，先 rebase/sync/rerun。
  3. 公开 PR comment/body 禁止写内部远端路径、`/tmp`、本地 `%TEMP%`、status/log 文件路径，除非用户明确要求 debug 细节。默认只写 reviewer 需要的信息：head、case、result、metrics、stable image URL。
  4. 图片上传后先 `HEAD` raw URL 验证 `200 image/png`，并打开图片确认不是旧图/裂图/空图。
  5. 发评论前本地读一遍 Markdown body，专门搜索内部路径模式：

     ```powershell
     Select-String -Path <body-file> -Pattern '/data/|/tmp/|AppData|Artifact source|status.txt|\\.log'
     ```

     - 命中就删，除非它是用户明确要求的调试记录。
- **验收标准**：PR 页面上的图片和 metrics 可追溯到当前 head；评论没有内部路径；如果要引用历史结果，标题必须显式写历史 head，避免 reviewer 误解成 current-head evidence。
