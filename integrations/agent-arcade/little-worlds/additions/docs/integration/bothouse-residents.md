# Bothouse 星球居民

在 Agent Arcade 的「更多 → 小星球」里，着陆自己的星球后点「连接我的 AI」。世界沿用当前房主会话，好友服务用当前账号已配对的 Bothouse 目录同步居民。回到消息后同步继续。要移除这批居民，在自己的星球点「断开我的 AI」。如果好友服务离线，App 来源超过 30 秒未更新后，来访者再读取时看不到旧名录和头像。原档再次连接可恢复。独立浏览器和命令行的连接方法见下文。

好友账号和世界玩家分别保存。原 App 档案可续接原星球；新设备、清空本地世界会话或换浏览器后，仅凭好友账号或昵称不能取回旧房主身份。原世界存档仍保留。房主的 App 来源与独立发布端分别管理，同一实例已有独立来源时，应在原世界居民设置中核对并解除旧来源再连接。

世界页面或嵌入宿主沿用现有的 `little_post` 身份。客户端在着陆后按已有 planetId 读取 `GET /api/planets/:planetId/residents`。返回 `{residents:[{id,displayName,appearanceKey,activity}]}`；按 id 更新，换星球时丢弃上一次响应。不存在居民时数组为空。飞行中或查询别的星球返回 403。活动值为 idle、thinking、working、talking、waiting、offline、unknown。外观使用此项目实际配置的头像 slug，未配置或选择有歧义时为 default。内置形象沿用随包素材。自定义形象由房主的发布端随当前角色提供，访客着陆后从同一世界读取已获准的 PNG。

主人的现有星球页面可链接到同源 `/resident-settings`。在那里连接或移除自己的发布端。宿主也可用同一世界会话 POST `/api/planets/:planetId/residents/connect`（空 JSON），拿到此发布端专用的 token；可 POST 同路径的 `disconnect`，正文为 `{sourceId}`。token 只在创建时交给主人。宿主可通过本地进程环境传给发布端，无需另行登录。连接不需要把 Bothouse 管理凭据交给世界。

在运行本人 Bothouse 的主机上执行（Python 3.11 以上）：

```
python scripts/publish-residents.py --config <本人的Bothouse-config.toml> --world <世界服务原点>
```

首次按提示粘贴该发布端的 token（输入隐藏）；托管启动可传进程环境 LITTLE_WORLDS_PUBLISHER_TOKEN。默认同步所选本机实例中获准的全部角色，跟随新增、改名与移除。可选 `--project bridge:role-1` 缩小范围。个人专用实例只自动展示未配置个人 ACL 的桥接项目，以及本机 DSH 提供的 AI 成员。共享宿主应同时传 `--friends-origin <回环好友服务> --friend-account <已登录的用户号>` 和进程环境 LITTLE_WORLDS_FRIENDS_COOKIE，从该人的现有目录取当前允许的角色。已配对的共享宿主只发布当前好友账号的已授权角色。如果该版本的好友目录只提供 Bridge，原生 DSH 仍可通过房主的本机独立发布器使用。世界可用 HTTPS，本机联调可用回环 HTTP。停掉发布端后状态于 30 秒后变为 unknown；角色明确离线才显示 offline。解除连接立即移除这一来源的居民。

## 状态和交接核对

复用 Bothouse [角色聚合与项目标识](https://github.com/zuiho-kai/bothouse/blob/8ec73a8f32573b5307922df3c79675a934cdefb7/bridge/core/role_events.go)、[管理端 SSE](https://github.com/zuiho-kai/bothouse/blob/8ec73a8f32573b5307922df3c79675a934cdefb7/bridge/core/management_role_events.go) 与[协作桌的来源说明](https://github.com/zuiho-kai/bothouse/blob/8ec73a8f32573b5307922df3c79675a934cdefb7/dsh/collab/desk/README.md)。每轮取 SSE 的首个聚合快照就关闭，不读取后续消息帧。idle、thinking、working 与明确 offline 有直接对应；当前上游快照不能分辨的状态返回 unknown。瞬时讲话和交接不作保证。Bridge 外观从同实例 setup/state 的 team 和 cloud_web_team 按精确项目名选取，多个不同选择时回退。原生 DSH 角色使用 Channels 成员的内置造型选择。发布器仅在角色已入选后读取本机 owner 记录所指的 Channels 成员状态，或使用 Bothouse 管理页的本机代理。上传头像和外部图片地址使用通用造型。没有可读的造型选择时继续使用原来的内置 CLI／模型造型。成员改名仅更新显示名，稳定成员 ID 保持原 NPC。DSH 忙闲取管理端实时快照的已知阶段，未识别的状态显示未知。命令行和 Windows 宿主从同一发布入口读取本机素材库。世界只请求当前名录缺少的获准图像。更换或撤去素材并成功刷新名录后，旧图地址失效。详见[自定义头像契约](resident-portrait-transfer.md)。

星球按原 cookie、数据库 owner_id 和已着陆星球核对访客与主人的权限。发布端凭据只授权该来源，在世界数据库仅存摘要；每个来源第一次发布后固定实例的公开签名指纹。发布端是获授权主人的受信进程（状态由它报告，并非可验证的远端签名）。Bridge 的稳定居民号与好友目录相同，由实例公钥指纹和真实项目名推得；DSH 原生成员使用独立来源前缀。显示名仅作展示。每次整体刷新会替换该来源旧名录，1 MiB 传输上限，超过时拒绝整笔，旧状态按时过期。世界保存公开名录，并按连接和居民保存获准图像、摘要和署名。共享宿主认证丢失或切号会清空该发布端名录。

本地复核命令为 `node scripts/verify-residents.mjs`。它运行实际世界 HTTP、Python 发布端与临时 SQLite，两组管理 API/SSE 数据和好友目录由本机替身提供；不需要账号、模型或可见窗口。

公开素材包须有受支持的许可与署名。房主已有逐图许可时，可在对应配置旁保存同名的 .resident-portraits.json 文件（例如 config.resident-portraits.json）。文件为数组，每项的 instance、project、slug、pack 和净 PNG 的 sha256 须与本次图片匹配，并提供公开的 author 与 license。文件在每次发布前重读。
