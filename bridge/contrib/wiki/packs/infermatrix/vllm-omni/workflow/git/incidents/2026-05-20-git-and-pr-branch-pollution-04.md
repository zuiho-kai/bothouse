---
name: 2026-05-20-git-and-pr-branch-pollution-04
description: "2026-05-20 错题：PR #3766 描述图片用 tmpfiles 外链裂图、Test Plan 写成 UT 清单而非 e2e 复现、PowerShell 双引号 here-string 让三反引号被转义；改 no-BOM 文件、单引号 here-string、artifact branch raw URL 与 PR body render gate"
metadata:
  scope: "只收 2026-05-20 PR #3766 描述渲染失败、图片裂、Test Plan 不可复现这一起事故；PR 描述没按模板写归 2026-05-19-git-and-pr-branch-pollution-03，图片证据复用旧 head 归 2026-05-29-git-and-pr-branch-pollution-10"
---
# 2026-05-20 — PR #3766 描述渲染失败、图片裂、Test Plan 不可复现

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-20-git-and-pr-branch-pollution-04.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-20-git-and-pr-branch-pollution-04`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：PR #3766 描述渲染失败、图片裂、Test Plan 不可复现
- 影响范围：repos/vllm-omni/git
- **症状**：
  - PR 描述里图片使用 `tmpfiles` 临时外链，GitHub 页面裂图。
  - Test Plan 写成 UT / regression 覆盖清单，用户实际要的是 e2e 怎么复现：跑什么脚本、临时 YAML 怎么写、怎么发请求、指标怎么比。
  - PowerShell 写 PR body 时使用双引号 here-string，Markdown 三反引号被当成 escape，GitHub 上出现 `` `b + ash ``、tab + `ext` 一类乱码，代码块无法渲染。
  - 用户评价“pr描述的markdown格式不对，一坨屎”。
- **根因**：
  - 把 PR body 当成“提交成功即可”，没有当成 reviewer-facing artifact 做渲染级验收。
  - 没按需求聚焦 e2e 复现路径，拿内部验证清单替代用户要的脚本/YAML/请求。
  - 图片外链选择没有稳定性标准。
  - 没有读回检查 code fence、控制字符、图片 HTTP header。
- **正确补救**：
  1. 用 no-BOM UTF-8 文件重写 PR body；PowerShell 用单引号 here-string。
  2. PR body 结构收敛为：

     ```markdown
     ## Purpose
     ## Test Plan
     ### Environment
     ### Run Command
     ### Temporary YAML
     ### Request Construction
     ### Metric Comparison
     ## Test Result
     ### E2E Evidence
     ### Run Metadata
     ### Accuracy Metrics
     ### Artifacts
     ```

  3. 图片改用单独 artifact branch 上的 GitHub raw URL，并先 `HEAD` 验证 `200 image/png`。
  4. `gh pr view --json body` 读回检查：
     - 包含真正的 ```bash / ```yaml / ```python code fence。
     - 不含 ASCII control chars。
     - Test Plan 能按机器、命令、YAML、请求、reference metric 复现。
- **怎么避免**：
  1. 更新 PR 描述后必须跑“PR body render gate”：

     ```powershell
     $view = gh pr view <PR> --repo vllm-project/vllm-omni --json body | ConvertFrom-Json
     $view.body.Contains('```bash')
     $view.body.Contains('```yaml')
     $view.body.Contains('```python')
     $view.body -match "[\x00-\x08\x0B\x0C\x0E-\x1F]"  # 必须 False
     ```

  2. 图片 gate：

     ```powershell
     Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing
     ```

     - 必须 `200` 且 `Content-Type` 是图片。
  3. 用户要求 e2e / 精度 / 性能时，Test Plan 只写可复现 e2e。UT 覆盖最多一句带过，不要喧宾夺主。
  4. PR 描述写完要从 reviewer 视角读一遍：不看聊天上下文，也能知道在哪里跑、用什么配置、发什么请求、怎么验证结果。
