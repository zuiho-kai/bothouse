---
name: feature-github-issue-feedback-script
description: GitHub Issue 反馈创建脚本（gitcode-api 技能的 open_github_issue.py）功能概览：CLI 参数与退出码、GITHUB_ACCESS_TOKEN 优先于 --api-key、默认目标仓库、githubkit 薄封装与固定 API 版本、验证方式与设计取舍
metadata:
  scope: 只收 open_github_issue.py 的功能概览（CLI 入口、职责与数据流、设置项优先级、支持行为、验证方式、设计取舍）；实现深读归 feature-depth-github-issue-feedback-script
---
# GitHub Issue 反馈创建脚本（open_github_issue.py）

## 现状

- **CLI 入口与契约**
- 脚本提供单一 CLI 入口 `main(argv)`，返回进程退出码：参数为位置参数 `title`（议题标题）和必填选项 `--body`（议题正文）；另有可重复的 `--label`（收集为 `labels` 列表）、`--owner`、`--repo`、`--api-key` 选项。成功时通过 `gh.rest(version="2026-03-10").issues.create(**payload)` 创建议题并打印 `resp.parsed_data`，返回 0；
  - 缺少 GitHub 令牌时向 stderr 输出 `GITHUB_ACCESS_TOKEN is not set` 并返回 1。`__main__` 块通过 `raise SystemExit(main())` 暴露为可执行脚本。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L18–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L18-L55)
- **职责与数据流**
- 脚本位于 agent workspace 的 `skills/gitcode-api/scripts/` 目录，作为技能脚本被组织，职责单一：解析 CLI 参数 → 解析令牌 → 组装 payload dict（owner/repo/title/body，labels 仅在提供时加入）→ 调用 githubkit 的 `GitHub(auth=token)` REST 客户端创建议题 → 打印解析后的响应。它是薄封装层，议题创建逻辑全部委托给 `githubkit` 库，自身不含重试、分页或其他编排。`output_content = partial(print)` 是对输出的单一间接点。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L1–L50](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L1-L50)
- **设置项与优先级**
- 默认目标仓库为 owner `Trenza1ore`、repo `GitCode-API`，可通过 `--owner`/`--repo` 覆盖；REST API 版本固定为常量 `API_VERSION = "2026-03-10"`，不可通过 CLI 配置。令牌解析优先级：环境变量 `GITHUB_ACCESS_TOKEN` 优先于 `--api-key` 参数，两者皆空时以退出码 1 终止。`--body` 虽有 `default=""` 但被标记为 `required=True`。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L11–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L11-L37)
- **支持的行为**
- 支持在指定 GitHub 仓库创建带标题、正文和任意多个标签的议题（标签通过重复 `--label` 传入）。外部依赖为 `githubkit`（提供 `GitHub` 客户端与 REST API 版本化调用），令牌来自环境或 CLI。按目录命名推断，该脚本服务于 GitCode-API 技能，用于以 GitHub 议题形式提交反馈。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L3–L50](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L3-L50)
- **验证方式**
- 在本次展示的部分输入中，该脚本自身没有附带测试：文件仅 55 行，除 `main()` 和 `__main__` 入口外无其他可执行入口，也未引用任何测试框架。可观察的验证路径是手动执行 CLI——缺少令牌时会向 stderr 打印 `GITHUB_ACCESS_TOKEN is not set` 并返回退出码 1，成功创建时打印 `resp.parsed_data` 并返回 0；不在本次展示中的仓库其他位置的测试无法排除。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L18–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L18-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L48–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L48-L55)
- **Design Tradeoffs**
- Inference / 设计推断（非作者历史意图）：
- Token resolution prefers environment variable `GITHUB_ACCESS_TOKEN` over the `--api-key` CLI option; when both are empty,
  - the script prints `GITHUB_ACCESS_TOKEN is not set` to stderr and returns exit code 1. This allows the script to run in environments with injected credentials while keeping the CLI option as a fallback (the specific benefit is inference).
  - The script is a thin wrapper that delegates the entire issue-creation call to githubkit's `GitHub(auth=token)` client with a fixed version constant `API_VERSION = "2026-03-10"`, printing `resp.parsed_data` on success; the only explicit error handling is the missing token check,
  - and API-call exceptions are not caught (cost is inference; no documentary evidence of the author's intent is shown).
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L31–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L31-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L13–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L13-L13),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L48–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L48-L51)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-github-issue-feedback-script.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L18-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L1-L50
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L11-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L3-L50
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L18-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L48-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L31-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L13-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L48-L51
- 源页字段（feature）：github-issue-feedback-script
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py
