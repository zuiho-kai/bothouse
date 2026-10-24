# 一句话切主角色（作者本机原样搬运）

- `../gate/lead.py`：识别「码农，你当主」「换回协调员」「让笔杆兜底」这类话（规则，不调模型；问句不算），
  当前主角色存产品数据目录的 `lead.json`（可用 `BOTHOUSE_DATA_DIR` 指定；`GATE_LEAD_FILE` 可显式覆盖），gate 每次判定实时读。
  团队名单和别名取 gate 的团队文件（`gate-team.json` / `GATE_TEAM`），成员可加 `"id"`（平台用户 ID，认 `<@id>`）。
- `../gate/gate.py`：`route()` 先认切换，再按当前主角色分流（主走主的规则，其余走 sub 规则）；
  `POST /lead {"action": "get"|"set", "who": ...}` 给角色自己查/自己当主；`/context` 切换后给每个角色附一次主/次身份段。
- `lead`：命令行客户端，`lead`（查）、`lead me`（按 `CC_PROJECT` 认自己）、`lead 码农`。

需要装 gate（同作者本机）：没装 gate 时不生效。

## 主角色工作手册（仅当前主角色可用）

- `PLAYBOOK.zh-CN.md`（原文）/ `PLAYBOOK.md`（英文译本）：主角色怎么带团队并行干活。
  gate 的 `/context` 只给当前主角色附这份手册（`../gate/lead.py` 的 `playbook()`），当次的不附；换主后新主的下一轮收到一次。
  `GATE_PLAYBOOK=<文件>` 换成英文版或自己的版本，`off` = 不附。gate 部署到别的目录时，把本目录一起带上或设 `GATE_PLAYBOOK`。
- 手册里用到的脚本（都从 gate 已有的配置读，见 `_team.py`，不写死名字和 ID）：
  - `t10 <pid>`：后台活满 10 分钟连子进程一起停。
  - `d10 <队友名字/别名/ID> "<简称>"`：10 分钟后队友没交回，就以调用者（`CC_PROJECT`，即当主角色）的身份在当前频道（`CC_SESSION_KEY`）发「暂停」；队友 ID 从团队文件的 `"id"` 读。到点由 `d10-fire` 判断。
  - `ws-handoff <交接文件> "<任务>"` / `ws-forward "<摘要>"`：把大活交给「工作区」频道里的主角色、之后转结果。
    工作区：配了 `WS_CHANNEL` 或团队文件顶层 `"workspace"` 就固定用它（频道已删时在当前频道同分类下新建）；
    没配就走桥的共享池（`<桥> workspace list/claim/new`，Discord、飞书、DSH、网页版同一套）：空着或本频道名下
    进行中不到 3 件的先用（件数少、编号小的先），都忙才 `new`。交活时在任务板上记一条并绑这个工作区（`ws`），
    编号记进交接记录的 `board`。升级前没绑编号的旧交接：每个聊天频道第一次 ws-handoff 时迁移一次，名下已没有
    在做条目的工作区放回池子（记在 `<GATE_SETUP_DIR>/ws-park-migrated.json`）。
    Discord token 读 `DISCORD_BOT_TOKEN` 或 `<GATE_SETUP_DIR>/secrets.env`。
    ws-handoff 按交接文件把来源聊天频道（`CC_SESSION_KEY`）记进 `<GATE_SETUP_DIR>/ws-handoff-last.json` 的 `tasks`；
    `ws-forward --notes <交接文件>` 按它转给那份交接的工作区。
  - `ws-up [--notes <交接文件>] "<内容>" [--ask]`：工作区里的主角色往交活进来的聊天频道上报（默认）或提问（`--ask`），
    以调用者的 `CC_PROJECT` 用 timer 叫醒那边；活来自多个聊天频道时必须给 `--notes`。Discord 工作区里另发一条不 @ 人的短消息。
    timer 命令读 `CC_BIN`，否则找 `bothouse`、`cc-connect`。测试：`python3 -I test_ws_up.py`（临时目录、假 timer，不走网络）。

## 任务板、过会儿回来、安全重启

- `board`（实现在 `../gate/board.py`）：谁手上有哪件事、做在哪、做到哪。`board add <事情> <分支/PR/路径> <状态> <谁> [--next 几点看]`、
  `board update <编号> <状态> …`、`board done <编号>`、`board pause <编号> [原因]` / `board resume <编号>`。
  ws-handoff 建的条目绑着工作区：`board pause`，或 `board update` 把「谁」改成别人时，跑 `<桥> workspace park`
  放掉它在那里的那件交接；那里没别的活在做，桥把工作区放回池子并清会话。手动 add 的条目不动桥。板子存 `BOARD_DIR`（默认 `<GATE_SETUP_DIR>/team`），
  `../gate/ctxsvc.py` 把整张板附进每个 bot 每轮的上下文（板子变了才重推，没用过任务板不附）。
  每次增改结束后，在条目所在频道（`CC_SESSION_KEY`）把「还没做完的事」编辑进同一条置顶消息；
  Discord token 读 `DISCORD_BOT_TOKEN` 或 `<GATE_SETUP_DIR>/secrets.env`，读不到只警告。
- `later <延时如 10m> "<事情>" "<到点要做什么>"`：挂 `cc-connect timer`，并在任务板记一行「下次看 几点」，用户在置顶卡片上看得见。所有角色（主和次）都能用：
  「谁」按 `CC_PROJECT` 经 `../gate/lead.py` 换成团队文件里的名字（认不出就写项目名）；会话按 `CC_SESSION_KEY`、`CC_SESSION` 顺序取，
  都没有就报错、不写板；定时挂不上会把刚记的那行撤掉。DSH 运行时会删掉名字含 KEY 的环境变量（dsh-subprocess 过滤
  `/KEY|PASSWORD|SECRET|TOKEN/i`），所以 DSH 的启动入口要加一行 `export CC_SESSION="${CC_SESSION_KEY:-}"`。
- `safe-restart "原因" "重启后接着做的事|无"`：等本轮回复发出再用 launchd 重启 cc-connect，约 2 分钟后用 `later` 叫醒本会话接着做（叫醒也上任务板）。
  必填 `CC_LAUNCHD_LABEL`；可选 `CC_LOG`、`CC_RESTART_LOG`、`CC_SIGN_BIN`+`CC_SIGN_ID`（签名检查）、`CC_PRE_RESTART`（重启前检查，失败只警告）。

## Install from the published binary

Run `bothouse setup lead install --work-dir /path/to/role --agent codex`
(optionally `--config /path/to/config.toml`). This extracts the embedded `lead/`
and sibling `gate/` files into `<data_dir>/collaboration` and adds absolute paths
to the role persona. Re-running refreshes tools without duplicating that block;
installed files you edited are skipped and listed unless you pass `--force`.
Python 3 and a POSIX-compatible shell are required. Configure `GATE_TEAM` or
`GATE_SETUP_DIR/gate-team.json`, `BOARD_DIR`, and platform credentials separately;
the example team is only a template. The scripts are installed, not a gate service.

`later` accepts `CC_BIN` for the bridge executable and otherwise searches
`bothouse`, then `cc-connect`. DSH exports `CC_SESSION`
from its runtime session key before its subprocess environment filter.
`board done <id> <rework-count> "<reason>"` archives rework data;
`board rework [days]` summarizes the last 14 days by default.
`safe-restart` requires macOS launchctl and explicit `CC_LAUNCHD_LABEL`;
installation does not invoke it or restart a running bridge.
