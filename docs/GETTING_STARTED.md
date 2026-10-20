# 从零用起 CoNest

CoNest 本体 = **ccm + wiki**：一群 AI 伙伴在聊天软件里一起说话、干活（ccm，即 cc-connect 的 maomao 分支，在 `bridge/`），
加上一份它们共用、会自己长的记忆（wiki，[llm-wiki](https://github.com/zuiho-kai/llm-wiki)）。
硬件（每位伙伴一块小屏板子）是可选的一层。

**没有硬件，走完线 1 和线 2 就能完整用。** 第一次运行 `cc-connect` 会直接打开安装向导：选平台、接机器人、每个角色选本机 CLI、人设、兜底角色、jev，其余全用默认值。 线 3 只在你手上有板子时才需要。

## 先选路线

```
             你                                    想要什么                         走哪几条
 ───────────────────────────────    ─────────────────────────────────    ─────────────
 只想在 Discord/飞书里有一群 AI      一主多 sub、会记事的 AI 群            线 1 → 线 2
 已经有 cc-connect 在跑              加上一主多 sub、wiki 记忆              线 1（跳过安装）
 手上有一块小智板子                  对板子说话，Discord 里的 AI 回、板子念    线 1 → 线 2 → 线 3
```

## 各部分怎么连

```
                 ┌──────────── 你的电脑 ────────────────────────────────┐
 Discord / 飞书 ◀─┼─▶ ccm（bridge/，cc-connect maomao 分支）              │
   （线 2）       │     │  每条消息先问 ──▶ gate（bridge/contrib/gate/）   │
                 │     │                   ├ /decide 谁回、回不回（本地小模型）
                 │     │                   └ /context 每轮推相关 wiki 页 ──▶ ~/wiki（llm-wiki）
                 │     ▼                                                 │
                 │   Claude Code / Codex / … 的会话（一个 bot 一个）      │
                 │                                                       │
                 │   角色小家主机（role-household/，可选，线 3）           │
                 └──────▲─────────────────────────────────────────────────┘
                        │ 局域网 Wi-Fi（OTA + WebSocket）
                    小智板子（可选，线 3）
```

## 术语

- **ccm / maomao 分支**：`bridge/` 里的 cc-connect 分支。比上游多了 gate、一主多 sub、队友状态、bot 之间交接。
- **主 bot / sub**：主 bot 默认接话；sub 听得到群里每句话，只有被 @ 或被点名才开口。
- **gate（快脑）**：每条消息先问它「回 / 插进正在做的这一轮 / 不回」。先走规则，规则定不了再让本地 Qwen 读选项概率。
- **wiki**：llm-wiki 的分层记忆（`MEMORY.md` → 域 `README.md` → 主题页）。会话结束后自动整理进去，gate 每轮把相关的页推给 bot。
- **角色小家主机**：`role-household/`，管板子（语音进出、表盘），也负责把你对板子说的话发进 Discord。
- **jev**：只做选择题、给出选项概率的模型。gate 用它判断群里一句话该哪个角色回；接了板子时，角色小家也用它选频道。
  向导里三个框（Base URL、Key、模型）填一个给概率的 OpenAI 兼容模型就行；没有时 gate 按规则判、判不了交给兜底角色，选频道按读音匹配。

## 三条线

| 线 | 文档 | 做完会看到什么 |
|---|---|---|
| 1. 配 ccm 和 wiki | [ccm-and-wiki.md](ccm-and-wiki.md) | 本机 cc-connect 跑着一主多 sub；gate 在 9930 端口；bot 回话前收到「可能相关的 wiki 页」；会话结束后 wiki 多了记录 |
| 2. 接进 Discord 或飞书（安装向导：网页点几下，或让 AI 跑一条命令） | [connect-discord-feishu.md](connect-discord-feishu.md) | Discord 里几个 bot 按 gate 的判断接话、互相交接；飞书里一个 bot 能对话；（有板子时）默认发言频道和自动选频道配好 |
| 3. 接硬件（可选） | [hardware.md](hardware.md) | 板子屏幕显示角色表盘；叫她的名字，这句进 Discord，她的回答在板子上念出来 |

## 升级须知：role-household/roles.toml 不再进 git（2026-10-20）

`role-household/roles.toml` 以前在仓库里，带着原作者服务器的 ID；现在改成每人自己的本地文件，仓库只留模板
`role-household/roles.example.toml`，`.gitignore` 忽略它。**之前 clone 过、本地有这个文件的人，拉这次更新会让 git 删掉它**
（没改过的副本直接删；改过的会让 pull 停下）。保住自己的配置：

```sh
cp role-household/roles.toml /tmp/roles.toml.mine     # 拉之前先备份
git checkout -- role-household/roles.toml             # 改过的话先丢掉工作区改动（内容已在备份里），否则 pull 会停下
git pull
cp /tmp/roles.toml.mine role-household/roles.toml      # 放回去，从此 git 不再管它
```

忘了备份：从删它的那次提交的上一版取回

```sh
git show "$(git log -1 --diff-filter=D --format=%h -- role-household/roles.toml)^:role-household/roles.toml" > role-household/roles.toml
```

## 遇到问题

- 先看各篇末尾的「怎么验证」。
- 仓库协作流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)；密钥、日志、对话都不进 git。
