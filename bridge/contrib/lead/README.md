# 一句话切主角色（作者本机原样搬运）

- `../gate/lead.py`：识别「码农，你当主」「换回主管」「让笔杆兜底」这类话（规则，不调模型；问句不算），
  当前主角色存 `GATE_LEAD_FILE`（默认 `~/.cc-connect/gate-lead.json`），gate 每次判定实时读。
  团队名单和别名取 gate 的团队文件（`gate-team.json` / `GATE_TEAM`），成员可加 `"id"`（平台用户 ID，认 `<@id>`）。
- `../gate/gate.py`：`route()` 先认切换，再按当前主角色分流（主走主的规则，其余走 sub 规则）；
  `POST /lead {"action": "get"|"set", "who": ...}` 给角色自己查/自己当主；`/context` 切换后给每个角色附一次主/次身份段。
- `lead`：命令行客户端，`lead`（查）、`lead me`（按 `CC_PROJECT` 认自己）、`lead 码农`。

需要装 gate（同作者本机）：没装 gate 时不生效。

## 主角色工作手册（谁当主谁拿到）

- `PLAYBOOK.zh-CN.md`（原文）/ `PLAYBOOK.md`（英文译本）：主角色怎么带团队并行干活。
  gate 的 `/context` 只给当前主角色附这份手册（`../gate/lead.py` 的 `playbook()`），当次的不附；换主后新主的下一轮收到一次。
  `GATE_PLAYBOOK=<文件>` 换成英文版或自己的版本，`off` = 不附。gate 部署到别的目录时，把本目录一起带上或设 `GATE_PLAYBOOK`。
- 手册里用到的脚本（都从 gate 已有的配置读，见 `_team.py`，不写死名字和 ID）：
  - `t10 <pid>`：后台活满 10 分钟连子进程一起停。
  - `d10 <队友名字/别名/ID> "<简称>"`：10 分钟后队友没交回，就以调用者（`CC_PROJECT`，即当主角色）的身份在当前频道（`CC_SESSION_KEY`）发「暂停」；队友 ID 从团队文件的 `"id"` 读。到点由 `d10-fire` 判断。
  - `ws-handoff <交接文件> "<任务>"` / `ws-forward "<摘要>"`：把大活交给「工作区」频道里的主角色、之后转结果。
    工作区频道 ID 读 `WS_CHANNEL` 或团队文件顶层 `"workspace"`；都没有就在当前频道同分类下新建一个。
    Discord token 读 `DISCORD_BOT_TOKEN` 或 `<GATE_SETUP_DIR>/secrets.env`。

## 任务板、过会儿回来、安全重启

- `board`（实现在 `../gate/board.py`）：谁手上有哪件事、做在哪、做到哪。`board add <事情> <分支/PR/路径> <状态> <谁> [--next 几点看]`、
  `board update <编号> <状态> …`、`board done <编号>`。板子存 `BOARD_DIR`（默认 `<GATE_SETUP_DIR>/team`），
  `../gate/ctxsvc.py` 把整张板附进每个 bot 每轮的上下文（板子变了才重推，没用过任务板不附）。
  每次增改结束后，在条目所在频道（`CC_SESSION_KEY`）把「还没做完的事」编辑进同一条置顶消息；
  Discord token 读 `DISCORD_BOT_TOKEN` 或 `<GATE_SETUP_DIR>/secrets.env`，读不到只警告。
- `later <延时如 10m> "<事情>" "<到点要做什么>"`：挂 `cc-connect timer`，并在任务板记一行「下次看 几点」，用户在置顶卡片上看得见。
- `safe-restart "原因" "重启后接着做的事|无"`：等本轮回复发出再用 launchd 重启 cc-connect，约 2 分钟后用 timer 叫醒本会话接着做。
  必填 `CC_LAUNCHD_LABEL`；可选 `CC_LOG`、`CC_RESTART_LOG`、`CC_SIGN_BIN`+`CC_SIGN_ID`（签名检查）、`CC_PRE_RESTART`（重启前检查，失败只警告）。
