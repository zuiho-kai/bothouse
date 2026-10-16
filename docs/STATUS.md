# 能力与验证状态

快照：2026-10-16，Asia/Shanghai。“已实现”指源码存在；“已部署”指旧运行环境已有该版本；“已验收”必须说明具体场景。新仓库本轮未部署。

| 能力 | 实现/旧环境部署 | 证据与尚未完成 |
| --- | --- | --- |
| 六个 Discord bot、点名交接、忙闲状态 | 已实现、旧环境已运行 | 既有部署记录；不等于自动项目协作 |
| 活动、采集、归档、日报阅读页 | 已实现、已部署 | 09/12/15/18/21活动、22日报；2026-10-16 18:19采集正常；21/22结果尚待检查 |
| 活动主持人跟随配置切换 | 已实现、已部署到旧 Python 目录 | 已切 G哥；38项活动/阅读页测试历史通过；新独立环境也纳入测试 |
| 电脑单人语音 | 已实现、已部署 | G哥原会话回答/播放已有验证；真人麦克风体验与主观音色待验收 |
| 本机自然音色 | Qwen3-TTS 已接入 | 不等于用户已认可；端到端延迟尚未完整测量 |
| 共享语音记录 | 已实现、旧环境已部署 | 同一伙伴原会话、其他伙伴按需读；跨角色真实验收仍缺 |
| 语音正文不重复到 Discord | 已有实现与隔离测试 | 仍需完整真人跨入口验收 |
| 模型切换 skill | 六个 bot 已部署 | 2026-10-16 18:12六次只读 list 查询通过；各 bot 真人切换与下一轮证据未齐 |
| 按需子 Agent | 已部署行为技能 | Codex隔离验收：普通→授权派工/验收/回收→普通；其他后端未完整验收；不是硬权限控制 |
| 项目 Issue→PR 协作 | 本仓库正在建立流程 | 自动认领、文件锁、合并未实现；真实项目完整验收未完成 |
| 新机器部署 | 未完成 | 仍有旧绝对路径、固定角色/频道、外部配置依赖 |
| ESP32 单/多设备 | 未实现 | 先验收电脑，再确定设备和协议 |
| 伙伴间“涌现” | 目标，未证明 | 需持续真实合作产物与行为变化；不能由定时消息证明 |

## 本轮独立目录验证

- companion：uv sync 创建独立环境；uv run python -m pytest -q → **102 passed, 1 skipped**。跳过项是真实语音识别模型测试，未发 Discord 消息或调用真实模型。
- bridge：go build -tags no_web -o ../.local/cc-connect ./cmd/cc-connect → **通过**。
- bridge（本机macOS）：go test -tags no_web ./... → **失败**，涉及 antigravity、codex、opencode、daemon、media_pipeline。core、cmd、config、Discord等包本轮通过。
- 为区分并行负载影响，串行复核上述失败包：antigravity/codex/opencode通过；daemon的 TestLaunchdStatusUsesUserDomainWhenGUIDomainUnavailable 仍失败；media_pipeline出现另一处 TempDir 清理竞争。不得把复核部分通过改写为全量通过，完整根因待专项修复。
- 初次直接 uv run pytest 导入本地模块失败，改用 python -m pytest 后通过；不引入旧网页 demo 的 conftest。

本机原始日志在新目录 .local/ 下：companion-tests-module.log、bridge-tests.log、bridge-failure-check.log；不提交完整运行日志。后续改代码后应重新验证，以上不自动代表新版本。

2026-10-16，GitHub Ubuntu [CI run 38889638594](https://github.com/Zssan12/conest/actions/runs/38889638594) 在0ed5b4f0上通过：Go校验、构建、全量测试（-p 1 -count=1）与Python检查均成功。这补充Linux环境证据，不覆盖或消除上述macOS失败。工作流变更不修改业务代码，后续提交以对应CI结果为准。

## 产品约束

G哥当前生产权限仍为 suggest/read-only。代码有派工能力不表示拥有项目写权限。模型可用性、额度与权限需按实际后端核对，不能凭 bot 自称判断。

当前macOS Go回归失败使本快照仍不具备完整发布验收；仓库基线保存既有工作，后续功能PR必须说明相关检查及未解决缺口。文档/协作流程PR可以在自身检查和审核通过后合并，不能把它等同于修复Issue #3或发布软件。

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
