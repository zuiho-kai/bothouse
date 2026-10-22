# 一句话切主角色（作者本机原样搬运）

- `../gate/lead.py`：识别「码农，你当主」「换回主管」「让笔杆兜底」这类话（规则，不调模型；问句不算），
  当前主角色存 `GATE_LEAD_FILE`（默认 `~/.cc-connect/gate-lead.json`），gate 每次判定实时读。
  团队名单和别名取 gate 的团队文件（`gate-team.json` / `GATE_TEAM`），成员可加 `"id"`（平台用户 ID，认 `<@id>`）。
- `../gate/gate.py`：`route()` 先认切换，再按当前主角色分流（主走主的规则，其余走 sub 规则）；
  `POST /lead {"action": "get"|"set", "who": ...}` 给角色自己查/自己当主；`/context` 切换后给每个角色附一次主/次身份段。
- `lead`：命令行客户端，`lead`（查）、`lead me`（按 `CC_PROJECT` 认自己）、`lead 码农`。

需要装 gate（同作者本机）：没装 gate 时不生效。
