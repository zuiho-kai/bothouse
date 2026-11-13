# 先选一条路

三条路做完都是一样的结果：你在聊天里 @ 一个 AI 队员说话，它回你，还能把活派给别的队员。区别只在「在哪儿聊天」。

## 问自己三个问题

1. **只是想先试试，看它能干嘛？** → 走 [路线 A：DSH 桌面版](./dsh)。
2. **想在手机上用，或者想拉朋友进同一个群？** → 走 [路线 B：Discord](./discord)。
3. **一定要在 QQ 里用？** → [路线 C：QQ](./qq) 现在还没走通，先用 A 或 B，QQ 好了再加上。以后随时能加新的聊天软件，已有的队员和记忆都不动。

## 三条路对比

| | A：DSH 桌面版 | B：Discord | C：QQ |
|---|---|---|---|
| 要注册什么 | 不用 | 一个 Discord 账号，再建机器人 | 一个给机器人用的 QQ 小号 |
| 要复制密码吗 | 不用 | 要（机器人的密码） | 要 |
| 手机上能用吗 | 不能，只在这台电脑上 | 能 | 能 |
| 别人能进来一起用吗 | 不能 | 能 | 能 |
| 大概多久 | 约 15 分钟 | 步骤最多 | 还没走通 |
| 我们实测到哪 | 全程走通 | 全程走通 | 只到第 2 步 |

## 三条路都要先准备

- **一台电脑**：Mac、Windows、Linux 都行。
- **一个 AI**：下面三种任选一种，见「还没有 AI 工具？」。

## 还没有 AI 工具？ {#no-ai}

bothouse 自己不带 AI，要借用你已有的。三种办法，选一种：

1. **最省事（只适合路线 A）：一把 DeepSeek 的 API Key。** API Key 就是一串让程序替你用 DeepSeek 的密码。去 [platform.deepseek.com](https://platform.deepseek.com) 注册、充一点钱（按用量扣费），在「API Keys」页点创建，复制那串 `sk-` 开头的字，装的时候贴进去。什么都不用装。
2. **Codex**（OpenAI 出的）：一般要一个 ChatGPT 付费账号。照 [Codex 官方说明](https://github.com/openai/codex) 装好，打开终端敲 `codex`，按提示用 ChatGPT 账号登录；能和它正常聊天，就算登录好了。
3. **Claude Code**（Anthropic 出的）：一般要一个 Claude 付费账号。照 [Claude Code 官方说明](https://www.anthropic.com/claude-code) 装好，打开终端敲 `claude`，按提示登录；能正常聊天就算好了。

**终端**是电脑自带的一个打命令的窗口。Mac：按 `Command + 空格`，输入「终端」回车。Windows：开始菜单搜「PowerShell」打开。

准备好了，下一步：[装 bothouse](./install)。
