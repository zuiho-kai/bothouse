---
name: feature-depth-github-issue-feedback-script
description: open_github_issue.py 实现深读：main 完成路径与 token 守卫、CLI 契约与默认值、token 解析顺序、githubkit 依赖与 API 版本 pin、API 异常不捕获、环境变量覆盖 --api-key 的取舍
metadata:
  scope: 只收 open_github_issue.py 的实现深读条目（流程、接口、配置、依赖、失败模式、取舍）；功能概览归 feature-github-issue-feedback-script
---
# GitHub Issue 反馈创建脚本：实现深读

## 现状

- [[feature-github-issue-feedback-script]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **main 完成 path：token 解析守卫通过后构造 GitHub 客户端并调用 issues.create，打印 parsed_data 并返回 0** main(argv) 先 argparse 解析 title 与必需的 --body；token 取 os.getenv("GITHUB_ACCESS_TOKEN") 否则回退 args.api_key（L34）。
  - 若 token 为空，经 output_content（L15 定义为 partial(print)）向 stderr 输出 "GITHUB_ACCESS_TOKEN is not set" 并局部返回 1，不发起 API 调用（L35–L37）。
  - 否则组装 owner/repo/title/body，且仅当 --label 提供时加入 labels 列表（L39–L46），以 GitHub(auth=token) 调用 gh.rest(version=API_VERSION).issues.create(**payload)（L48–L49），随后 output_content(resp.parsed_data) 打印解析结果并返回 0（L50–L51）。返回 1/0 是函数局部返回值；L49 若抛出异常，所示 main 体内无 except，将向上传播。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L15–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L15-L15),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L18–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L18-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L39–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L39-L51)
- **CLI 契约：位置参数 title，--body 必填，--label 可重复，返回进程内 int** 调用方须提供位置参数 title 和必填 --body；--label 每次 append 可重复；--owner 默认 "Trenza1ore"、--repo 默认 "GitCode-API"、--api-key 默认空。main 返回 int（0 成功、1 缺 token），作为模块运行时经 raise SystemExit(main()) 转为退出码。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L18–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L18-L32),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L54–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L54-L55)
- **token 优先取环境变量 GITHUB_ACCESS_TOKEN，其次 --api-key** token = os.getenv("GITHUB_ACCESS_TOKEN") or args.api_key；owner/repo 默认常量 DEFAULT_OWNER="Trenza1ore"、DEFAULT_REPO="GitCode-API"，可被同名 CLI 参数覆盖。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L11–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L11-L13),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L29–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L29-L37)
- **依赖 githubkit.GitHub 执行创建，pin 到 rest version "2026-03-10"** 脚本导入 githubkit 的 GitHub 客户端并固定 API_VERSION="2026-03-10" 调用 issues.create；创建结果依赖 githubkit 的解析（resp.parsed_data）。此依赖未安装时脚本无法运行。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L9–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L9-L13),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L48–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L48-L51)
- **token 为空时向 output_content 传 stderr 并返回 1；API 异常未捕获** 当 GITHUB_ACCESS_TOKEN 未设置且 --api-key 为空（falsy）时，L34–L37 以参数 file=sys.stderr 调用 output_content("GITHUB_ACCESS_TOKEN is not set") 并 return 1，不发起 API 调用。L48–L49 无 try/except，githubkit 抛出的异常会从 main 原样传播。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L34–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L34-L37),
  - [jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L48–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L48-L51)
- **环境变量优先于 --api-key：便于无人值守，但非空的旧值会覆盖 CLI 传入 token** 设计推断（非作者历史意图）：
- L34 用 os.getenv("GITHUB_ACCESS_TOKEN") or args.api_key：环境变量非空时总是胜出，--api-key 仅在环境变量为空/falsy 时生效（推断：这便于脚本化无人值守运行，但代价是环境中残留的非空 token 会覆盖调用方在命令行显式传入的 --api-key）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L31–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L31-L37)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-github-issue-feedback-script.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L18-L32
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L54-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L11-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L29-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L9-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L48-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L34-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L31-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L15-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L18-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py:L39-L51
- 源页字段（feature）：github-issue-feedback-script
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py
