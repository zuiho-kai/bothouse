# 能力与验证状态

快照：2026-10-16，Asia/Shanghai。“已实现”指源码存在；“已部署”指旧运行环境已有该版本；“已验收”必须说明具体场景。部署与体验结果分开记录。

| 能力 | 实现/旧环境部署 | 证据与尚未完成 |
| --- | --- | --- |
| 六个 Discord bot、点名交接、忙闲状态 | 已实现、旧环境已运行 | 既有部署记录；不等于自动项目协作 |
| 空响应与额度反馈修复 | PR #18已合并，2026-10-16 21:26旧服务已部署 | 独立重建哈希、六连接/API/会话映射与自动检查通过；真人Discord审批及工具回答仍待验收，见[部署复核](ISSUE_13_DEPLOYMENT.md)；真实额度来源见[额度说明](QUOTA_REPORTING.md) |
| 失败回复的模型/额度尾注 | PR #29已合并，2026-10-16 23:35部署 | 新增CUJ红绿、macOS必要检查及Ubuntu CI通过；六连接/API/配置与会话连续性复核通过；CLI错误根因及真人Discord验收未完成，见[验证记录](ERROR_QUOTA_VALIDATION.md) |
| 大豆包历史错误污染终态 | 已有严格核验修复；发布跟踪Issue #34 | 红绿回归与真实隔离会话连续两轮通过；当前真实失败仍保留，真人Discord验收单独记录；见[终态核验](ANTIGRAVITY_TURN_STATUS.md) |
| 活动、采集、归档、日报阅读页 | 已实现、已部署 | 09/12/15/18/21活动、22日报；2026-10-16 18:19采集正常；21/22结果尚待检查 |
| 活动主持人跟随配置切换 | 已实现、已部署到旧 Python 目录 | 已切 G哥；38项活动/阅读页测试历史通过；新独立环境也纳入测试 |
| 电脑单人语音 | 已实现、已部署 | 用户2026-10-16报告本机单人测试通过，但合成等待过长；最近30字TTS耗时13.804秒、回答生成20.900秒。逐项跨入口记忆与主观音质未完整验收，见[最新反馈](HANDOFF.md) |
| 电脑多伙伴轮流语音 | PR #25已合并，桥接2026-10-16 23:11已部署；独立8793语音入口真实五段通过 | 显式名单、A→B→A隔离、逐伙伴音色通过自动/模拟浏览器验证；Grok独立真实CLI冷恢复记忆通过；G哥+Cursor真实CLI五段/播放/原会话及共享记录通过；多人真人听感待验收，见[MULTI_VOICE.md](MULTI_VOICE.md) |
| 电脑两轮语音讨论 | Issue #26 / PR #30已有实现，独立8793真实验收通过 | 2—3位、两轮+总结、播放确认推进、停止/失败不重发；124项Python通过、模拟浏览器五段/刷新/播放拒绝/停止通过；G哥+Cursor原会话完成五段且Discord无重复正文；真人听感待反馈，见[讨论说明](VOICE_DISCUSSION.md) |
| 本机自然音色 | Qwen3-TTS 已接入 | 不等于用户已认可；端到端延迟尚未完整测量 |
| CosyVoice备选音色 | 独立本机试听完成，未接入生产 | Issue #15：固定社区MLX版本生成同文对照；预热合成3.1–6.2秒，自然度待真人反馈，专名转写有歧义；见[实测记录](COSYVOICE_TRIAL.md) |
| 共享语音记录 | 已实现、旧环境已部署 | 同一伙伴原会话、其他伙伴按需读；跨角色真实验收仍缺 |
| 语音正文不重复到 Discord | 已有实现与隔离测试 | 仍需完整真人跨入口验收 |
| 模型切换 skill | 六个 bot 已部署 | 2026-10-16 18:12六次只读 list 查询通过；各 bot 真人切换与下一轮证据未齐 |
| Antigravity 原生模型发现 | 2026-10-17源码已修复，未部署 | 旧代码红绿回归、真实CLI13个模型及隔离切换排队通过；最终串行Go全量、相关race/完整CUJ、vet与构建通过；生产下一轮模型仍待验收，见[模型发现验证](ANTIGRAVITY_MODEL_DISCOVERY.md) |
| 按需子 Agent | 已部署行为技能 | Codex隔离验收：普通→授权派工/验收/回收→普通；其他后端未完整验收；不是硬权限控制 |
| 项目 Issue→PR 协作 | 本仓库正在建立流程 | 自动认领、文件锁、合并未实现；真实项目完整验收未完成 |
| 新机器部署 | 未完成 | 仍有旧绝对路径、固定角色/频道、外部配置依赖 |
| ESP32 单/多设备 | 未实现 | 先验收电脑，再确定设备和协议 |
| 伙伴间“涌现” | 目标，未证明 | 需持续真实合作产物与行为变化；不能由定时消息证明 |

## 初始导入验证（修复前）

- companion：uv sync 创建独立环境；uv run python -m pytest -q → **102 passed, 1 skipped**。跳过项是真实语音识别模型测试，未发 Discord 消息或调用真实模型。
- bridge：go build -tags no_web -o ../.local/cc-connect ./cmd/cc-connect → **通过**。
- bridge（本机macOS）：go test -tags no_web ./... → **失败**，涉及 antigravity、codex、opencode、daemon、media_pipeline。core、cmd、config、Discord等包本轮通过。
- 为区分并行负载影响，串行复核上述失败包：antigravity/codex/opencode通过；daemon的 TestLaunchdStatusUsesUserDomainWhenGUIDomainUnavailable 仍失败；media_pipeline出现另一处 TempDir 清理竞争。不得把复核部分通过改写为全量通过，完整根因待专项修复。
- 初次直接 uv run pytest 导入本地模块失败，改用 python -m pytest 后通过；不引入旧网页 demo 的 conftest。

本机原始日志在新目录 .local/ 下：companion-tests-module.log、bridge-tests.log、bridge-failure-check.log；不提交完整运行日志。后续改代码后应重新验证，以上不自动代表新版本。

2026-10-16，GitHub Ubuntu [CI run 38889638594](https://github.com/Zssan12/conest/actions/runs/38889638594) 在0ed5b4f0上通过：Go校验、构建、全量测试（-p 1 -count=1）与Python检查均成功。这补充Linux环境证据，不覆盖或消除上述macOS失败。工作流变更不修改业务代码，后续提交以对应CI结果为准。

## Issue #3 修复验证

[PR #14](https://github.com/Zssan12/conest/pull/14) 已完成根因复现和修复。macOS全量 go test -tags no_web -count=1 ./...（默认并发）、构建/vet、关键生命周期-race与CUJ通过；Ubuntu [CI run 38894302371](https://github.com/Zssan12/conest/actions/runs/38894302371) 的Go全量与Python检查也通过。代码提交8c860baf，详细证据和局限见[Go测试基线诊断](GO_TEST_BASELINE.md)。上面保留初始失败记录；后续版本以各自检查为准。没有部署到旧生产服务。

## 产品约束

2026-10-16 23:24旁支记录G哥经用户授权改为 yolo，23:35部署保持；权限须以操作时的配置与运行态核对。语音讨论提示只授权交流建议，不授予项目执行或派工；这是行为约定，不是CLI工具沙箱。模型可用性、额度与权限不能凭 bot 自称判断。

Go测试基线已通过修复验证；独立实例配置、真实电脑语音/共享记忆、真实后端和硬件仍需对应Issue验收。后续功能PR必须说明相关检查及未解决缺口，不把自动测试或合并等同于产品发布。

## 工作入口

进度、验收清单与讨论以对应 Issue 为准；下表只说明处理顺序，不维护第二份状态。

| 顺序 | Issue |
| --- | --- |
| 仓库协作基础 | [#1 工作流与统一交接](https://github.com/Zssan12/conest/issues/1) |
| 先消除新目录误连旧实例的风险 | [#2 独立实例配置](https://github.com/Zssan12/conest/issues/2) |
| 修复自动验证基线 | [#3 Go测试失败](https://github.com/Zssan12/conest/issues/3) |
| 验证核心用户体验 | [#4 电脑语音与共享记忆](https://github.com/Zssan12/conest/issues/4) |
| 验证各后端真实能力 | [#5 模型切换与按需子Agent](https://github.com/Zssan12/conest/issues/5) |
| 用真实产物验证协作 | [#6 项目交付闭环](https://github.com/Zssan12/conest/issues/6) |
| 核对真实活动结果 | [#7 活动与日报](https://github.com/Zssan12/conest/issues/7) |
| 电脑验收后推进 | [#8 单设备展示](https://github.com/Zssan12/conest/issues/8) |
| 补齐来源资料 | [#9 许可与归属](https://github.com/Zssan12/conest/issues/9) |
