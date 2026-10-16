# 共栖 · CoNest

让同一组 AI 伙伴在 Discord 和语音之间接着聊，按需协作完成真实项目，并留下可追溯的记忆、作品和每日记录。

CoNest 基于 cc-connect 的 maomao 分支与一家子产品扩展整合。面向希望长期和多位 AI 伙伴共事、交流的个人用户。当前已具备 Discord 多 bot、电脑单人语音与活动日志的实现；硬件和自动项目协作仍待完成。详细能力与证据见 [状态表](docs/STATUS.md)。

## 从目标理解系统

| 要素 | 定义 |
| --- | --- |
| 目标 | 同一伙伴跨文字和语音保留上下文，按授权做事，成果可检查 |
| 输入 | Discord 消息、电脑语音、明确项目任务、配置的活动时刻 |
| 输出 | 文字或语音回答、代码/文档/PR、共享记录和每日手记 |
| 反馈 | 真人评价、测试和审核、实际模型/会话信息、可追溯的活动结果 |

我们希望观察伙伴之间持续产生新的合作，但不会用定时聊天次数或模型自述证明“涌现”。验收标准见 [产品目标](docs/GOALS.md)。

## 目录与入口

- [bridge/](bridge/)：Go 桥接、会话、平台和 CLI 适配器。保留 cc-connect 命令与 Go module 名称以维持兼容。
- [companion/](companion/)：Python 语音、共享记录、自主活动、日报与阅读页。
- [skills/](skills/)：产品协作技能；模型切换技能随桥接嵌入。
- [协作流程](CONTRIBUTING.md)、[Agent 入口](AGENTS.md)。
- [架构](docs/ARCHITECTURE.md)、[当前交接](docs/HANDOFF.md)、[代码来源](SOURCE_ORIGINS.md)。
- [回复额度查询](docs/QUOTA_REPORTING.md)：真实额度来源、支持范围与只读验收方式。

## 本地开发验证

需要 Go（版本见 bridge/go.mod）、Python 3.11+ 和 uv。以下命令不启动生产服务，也不需要 Discord 凭据：

~~~sh
mkdir -p .local
cd companion
uv sync --locked
uv run python -m pytest -q
cd ../bridge
go build -tags no_web -o ../.local/cc-connect ./cmd/cc-connect
go test -tags no_web ./...
~~~

Python 使用 python -m pytest，让本地源码进入导入路径。实际语音识别、自然音色依赖另见 companion/requirements-voice.txt 和 requirements-tts.txt；基础测试不下载模型。no_web 构建不包含上游网页控制台。

多伙伴语音的显式名单入口、会话恢复边界与验收证据见[多伙伴电脑语音](docs/MULTI_VOICE.md)。本版一次选择一位伙伴，支持轮流回答与逐伙伴音色；源码验证不等于已经部署，口头点名与多人自主讨论尚未实现。

2026-10-16，Issue #3 修复后的 macOS 与 Linux Go 全量测试均通过。原始失败、根因及回归证据见 [Go 测试基线诊断](docs/GO_TEST_BASELINE.md)。自动测试通过不代表真实 Discord 或麦克风体验已验收。

## 运行边界

这是源码整合后的开发仓库，尚不是一键部署包。旧服务仍从原目录运行。生产配置、CLI 登录态、共享记忆、录音和模型权重留在本机私密目录，未作为部署资产导入。

companion 的语音和活动入口仍含旧部署默认路径与角色/频道；在完成独立配置工作前，不要把它们当新实例初始化命令。尤其不要在原机器直接运行 init、install、serve 或调度修改命令来“验证新仓库”，它们可能连接现有实例。当前部署位置和接手方式见 [交接](docs/HANDOFF.md)。
