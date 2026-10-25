# 外部聊天平台接入：AstrBot / QQ 群 ↔ bothouse 频道（社区方案）

> 状态：社区贡献（Reels #321），**不改核心**；提供协议说明 + 最小参考实现 + 实测踩坑记录。
> 本页不含任何凭据、群号或本机路径。

## 1. 目标与边界

很多用户已经在用 AstrBot / MaiBot 这类第三方聊天机器人管理 QQ / 微信群。本方案让这些群里的消息进入 **bothouse 自建频道（hub）**，频道的角色回复再回到原群。

当前实现的是 **L1 通道级接入**：

- ✅ 群消息 → hub 频道（以"用户"身份发一条消息）；
- ✅ hub 里角色的回复 → 原群 / 私聊；
- ❌ 还不是 L2"成员身份"（外部 bot 作为频道成员被 gate 路由、出现在成员列表）——后续阶段。

## 2. 链路

```
QQ / 微信 群
   │ (bot 被 @ 时收到消息)
   ▼
AstrBot 插件（外部平台侧，见 bridge/contrib/astrbot-bridge/）
   │ ① POST /api/rooms/{room_id}/messages（Bearer <hub web token>，author_kind=user）
   ▼
bothouse hub（自建频道）
   │ gate 路由 → 角色（小鲸/小鱼/…）回复
   ▼
① 轮询 GET /api/rooms/{room_id}/messages，取 author_kind=role 的新消息
   │ ② 发回原会话
   ▼
QQ / 微信 群
```

## 3. 接入契约（复用现有 hub 接口）

| 项 | 说明 |
|---|---|
| 鉴权 | `Authorization: Bearer <hub web token>`（hub 管理端生成的访问 token） |
| 发消息 | `POST /api/rooms/{room_id}/messages`，body `{"text": "...", "author_kind": "user"}` |
| 读回复 | `GET /api/rooms/{room_id}/messages?limit=N`，过滤 `author_kind == "role"` |
| 去重/游标 | 客户端维护 `last_seen_id`；断线重连后从该 id 之后继续 |
| 触发控制 | 建议加触发前缀（如 `/hub`），只转发需要的消息，避免打扰普通群聊 |
| 防回环 | 跳过 bot 自己发出的消息；外部平台侧转发后截断事件，避免与人格插件重复回复 |

hub 的网页 token 只应保存在本机配置，不要提交到仓库或发到群里。

## 4. AstrBot 对接要点（v4 实测）

1. **事件优先级**：AstrBot 的消息处理器按 `priority` **从大到小**执行（源码 `sort(key=-priority)`）。若要让桥先拿到事件，优先级要高于其他人格/唤醒插件（实测需 ≥ 1e6 量级，具体以实际版本为准）。
2. **命令前缀会被吃掉**：消息开头的 `/` 可能被 AstrBot 当作命令前缀移除，`event.message_str` 可能是 `hub@小鲸 ...` 而不是 `/hub@小鲸 ...`；前缀匹配要同时接受两种写法。
3. **发送 API**：`event.send()` 需要 `MessageChain`（`MessageChain([Plain(text)])`），直接传单个 `Plain` 会报 `'Plain' object has no attribute 'chain'`。
4. **防重复回复**：桥转发后调用 `event.stop_event()`，避免同一条消息被其他人格插件再回一遍。

## 5. 隐私注意（重要）

bothouse 角色的回复可能附带 **reply footer**（模型/供应商列表、额度状态、本机工作目录）。对"对外"频道应关掉：

```toml
[[projects]]
  name = "role-1"
  reply_footer = false
  show_workdir_indicator = false
  show_quota_indicator = false
```

外部平台客户端也应再做一层清洗：过滤 `*[...]` 行、含"额度"的行、含本机盘符路径的行；以及角色的过程消息（`第 N 步 · …`）不应转发到外部群。

## 6. 参考实现

`bridge/contrib/astrbot-bridge/` 提供最小参考客户端（纯标准库）：

- `bridge_core.py`：发送群消息、轮询角色回复、隐私清洗；
- `test_bridge_core.py`：用本地假 hub 的单元测试（不依赖 AstrBot、不依赖真实 hub）；
- `README.md`：安装与配置说明。

完整 AstrBot 插件（含事件适配、并发锁、观察窗）由贡献者另行维护，本 PR 只收录协议说明与参考实现。

## 7. 验证方式

- 单元测试：`python -m unittest discover -s bridge/contrib/astrbot-bridge -v`（假 hub，覆盖发送/过滤/去重/隐私清洗）；
- 真实环境 e2e（贡献者本地）：QQ 官方机器人 + AstrBot + bothouse + 自建 hub，完成"群消息 → 频道 → 角色回复 → 回群"闭环，耗时约 30–60 秒；
- 本 PR 不含任何运行凭据、群号或本机路径。

## 8. 已知限制与后续

- 只处理文本；图片/文件/卡片未接入；
- HTTP 轮询（默认 1.5s），非 WebSocket 推送；
- 回复整轮一次性发回，非流式；
- L2 成员身份（外部 bot 作为频道成员、被 gate 路由）为后续独立工作，可能需要协议扩展或独立 Issue。
