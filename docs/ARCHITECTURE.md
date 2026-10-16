# 当前架构

## 边界和数据归属

| 模块 | 职责与接口 | 为什么独立 |
| --- | --- | --- |
| bridge/core | Engine、会话、队列、本地 API、技能注入 | 跨平台编排，不依赖具体 agent 或 platform 包 |
| bridge/agent | 原生 CLI 启动、事件解析、模型/权限与会话适配 | 各后端协议独立演进，向 core 暴露能力 |
| bridge/platform | Discord 等平台的接收与发送 | 平台差异留在适配器 |
| companion/voice | 浏览器录音、本机识别、严格会话续聊、语音合成和共享记录 | 音频生命周期与 Discord 投递分开；通过本地 Unix socket 调桥接 |
| companion/autonomy | 时刻表、动作状态、消息采集、Markdown/HTML 和每日手记 | 活动计划与归档独立于模型会话；通过桥接 API 和 Discord API 读取/投递 |
| skills | 当前真人授权下的协作行为约定 | 让 bot 理解语义并调用现有原生工具；不是工具权限沙箱 |

源码由 Git 保存；模型会话由相应 CLI 与桥接会话映射管理；共享语音记录、活动状态及消息 SQLite 库在外部运行目录。凭据只属于本地私密配置，不属于 Git。

## 真实消息流

Discord 消息 → platform/discord → core/engine.go → agent 适配器 → 原生 CLI → 事件过滤与输出 → Discord。

语音录音 → voice/static → voice/app.py 的 /api/transcribe → speech.py 本机识别 → /api/turn → voice/bridge.py 本地 API → 原 G哥会话 → 回答正文 → 本机 TTS/浏览器播放。

语音轮次写入 voice/memory.py 管理的共享记录。同一伙伴接续原会话；其他伙伴按需查阅。语音使用隔离的输出通道，正文不再次作为 Discord 消息发送。没有会话恢复证据时应报告失败，而不是悄悄开一个新角色替代。

## 消息处理的关闭边界

Engine通过bridge/core/engine_workers.go登记消息处理工作；开始关闭后拒收新工作，取消上下文并关闭会话/适配器，最后等待已登记的消息、队列、压缩、事件读取和Send结束。因此这些工作不会在Stop返回后继续写盘。OpenCode自己负责取消并等待模型缓存的后台刷新；测试必须先Stop，再回收临时目录。

此等待依赖适配器响应取消或Close，不是强制中断任意第三方代码，也没有覆盖所有非消息后台任务。边界及回归证据见[Go测试基线诊断](GO_TEST_BASELINE.md)。

## 活动和日志

autonomy/__main__.py 读取外部配置和历史状态，判断活动时段，通过本地桥接创建任务；采集已配置频道的消息，交给 journal.py 和 reading.py 生成归档与阅读页。日报保留原话归档，再尝试生成今日手记；额度不足不能写成成功。

当前主持人与普通 Discord 主 bot 是两个配置。leader 命令在既有锁内同步活动配置和 cron 归属，保留已有时刻与暂停状态；旧动作仍按原执行者核对。换模型/主持人不应清空历史重试。

## 模型与协作

模型切换说明在 bridge/core/skills/model-switch/SKILL.md，使用当前项目/会话环境先 list 再 set/effort/auto。只接受后端实际提供的准确标识；排队成功与下一轮已生效是两种状态。

子 Agent 使用原生 CLI 的真实能力。当前默认不派生，仅本次真人明确授权后最多两名、一层，父 Agent 收回并验收。约束见 skills/project-subagents/SKILL.md。多个 bot 共用目录不提供文件锁、任务认领或自动合并；人为分工与独立 worktree 仍然必要。

## 整合决策

本次把桥接与产品扩展放进同一仓库，因为一个功能经常同时修改 Go 和 Python，需要一个 PR 描述完整行为。保留 bridge 内部路径、Go module、CLI 名称及原 Git 历史，降低重命名风险并保留上游来源。

独立目录只接收源码，不替换运行服务。先完成配置可移植性与验收，再单独计划备份、切换和回滚。跨机器配置、多个硬件设备或多用户隔离确有需求时再调整边界。
