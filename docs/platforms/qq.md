# 在 QQ 里用 bothouse

一个 QQ 号登录到 [NapCat](https://github.com/NapNeko/NapCatQQ)，就是一个机器人。bothouse 通过 NapCat 的 WebSocket（OneBot 11）收发消息，在 QQ 群或私聊里和你对话。

```
QQ ←→ NapCat ←WebSocket→ bothouse ←→ 本机 CLI（Claude Code / Codex / …）
```

要准备：

- 一个给机器人用的 QQ 号（建议用小号）。
- 这台电脑上的 NapCat，已登录这个 QQ 号。
- 本机一个已登录的 CLI（`claude`、`codex`、`gemini`……）。

不需要 Discord、Node 或 pnpm。

## 1. 装 bothouse

见[首页第 1 步](../GETTING_STARTED.md#1-装)。

## 2. 启动 NapCat，开一个 WebSocket 服务器

按 [NapCat 文档](https://napneko.github.io/) 安装（Windows / macOS / Linux 都有一键包，也可以用 Docker）：

```sh
docker run -d --name napcat -e ACCOUNT=<机器人QQ号> -p 3001:3001 -p 6099:6099 mlikiowa/napcat-docker:latest
docker logs -f napcat   # 日志里有二维码，用手机 QQ 扫码登录
```

打开 NapCat 网页（默认 `http://127.0.0.1:6099`）→「网络配置」→ 新建「WebSocket 服务器」：

- 端口 `3001`（默认），启用。
- token：可以设一个（推荐），也可以留空。

## 3. 向导

运行 `bothouse`，浏览器会打开向导。第一页「你想在哪儿用」选 **QQ**，然后：

1. 填 NapCat WebSocket 地址（默认 `ws://127.0.0.1:3001`）、token、**你自己的 QQ 号**（只有这些号能指挥机器人；多个用逗号隔开；填 `*` 表示所有人都能指挥，不推荐）。token 留空会保留同一地址已有角色保存的值；新建时没设就空着。要删除已保存的 token，勾「清除已保存的访问令牌」，再测试连接。
2. 点「测试连接」。连上了会显示机器人的 QQ 号和昵称，才能点下一步。
3. 选本机 CLI → 人设（可跳过）→ 保存 →「重启生效」。

同一 WebSocket 地址已有角色时，连接测试后会带出原角色的 CLI 和人设。只改连接设置、没有选择其它 CLI 或勾选编辑人设时，原角色的 agent 配置及工作目录文件保持原样。

QQ 这一轮只接一个 QQ 号。gate、jev 是进阶功能，QQ 向导里不出现，见[首页「进阶，可不装」](../GETTING_STARTED.md#进阶可不装)。

不用浏览器（让 AI 帮你配）时，同一份请求走 `bothouse setup apply`：

```json
{"platform": "qq", "qq": {"ws_url": "ws://127.0.0.1:3001", "token": "<NapCat token>", "allow_from": "<你的QQ号>"}, "roles": [{}]}
```

存成权限 600 的文件，先 `bothouse setup apply --json <文件> --dry-run`（只测试连接，不写文件），输出里 `ok: true` 再去掉 `--dry-run` 跑。连不上时 `qq.code` 是 `unreachable`（NapCat 没起或地址不对）或 `unauthorized`（token 不对），`qq.fix` 写着怎么改。

重跑时 `qq.token` 省略或空串均保留原值；`qq.clear_token: true` 明确清空，测试连接也不带 token。已有角色的 `roles[].agent_type` 省略表示保留原 CLI，只有明确更换时才填写。

## 4. 确认上线

日志里出现 `qq: connected to OneBot` 和 `qq: logged in` 就是上线了。在 QQ 里私聊机器人，或在群里 @ 它说一句试试。

想关掉终端也一直在线：`bothouse daemon install`（见[首页第 3 步](../GETTING_STARTED.md#3-确认上线)）。

## 以后

- 再加 Discord、飞书等：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- 暂时不用 QQ：`bothouse module disable qq`，配置留着；`bothouse module add qq` 恢复。
- 更多 QQ 选项（文件发送用的 `http_url`、群里共享会话等）：[bridge/docs/qq.md](../../bridge/docs/qq.md)。
- 开发者可重跑的慢响应、断连、限流、取消和媒体隔离验证：[QQ 故障注入说明](../implementation/819-qq-resilience.md)。

## 静默监听群消息

适用于 OneBot/NapCat（不是 QQ 官方机器人）。在现有 QQ 平台的 options 中增加配置文件的绝对路径，其它选项保留：

~~~toml
[projects.platforms.options]
group_watch_config = "/absolute/path/qq-group-watch.json"
~~~

创建该 JSON 文件，权限设为 600。以下群号和主人号仅为示例，换成自己的；groups 先用空数组，确认需要监听哪些群后再填。base_url 是已配置的兼容 Chat Completions 服务根地址；key_file 指向仅含 API 密钥的私有文件，本地免密服务可省略。

~~~json
{
  "groups": [],
  "owner_qq": 123456789,
  "interval": "2h",
  "keywords": ["价格", "元", "券", "秒杀", "福利", "口令", "领取", "要闻"],
  "base_url": "http://127.0.0.1:8080/v1",
  "model": "your-configured-cheap-model",
  "reasoning_effort": "medium",
  "key_file": "/absolute/path/private-model-key"
}
~~~

重启对应 QQ 实例后生效。interval 默认 2h，可改成 1h；groups 为空时不收集、不调用汇总模型、不发摘要。reasoning_effort 按所选服务支持的级别填写，不支持该参数的模型省略此项。监听群中的 @、回复和命令也只收不回，不受 allow_from 限制，不能在这些群指挥机器人；其它群及私聊仍遵守原权限和聊天设置。

群主由 OneBot sender.role=owner 识别，每条独立原消息都保存，包括图片、表情与重复正文；媒体只保存原事件里的引用，不下载或做图片识别。其他成员只保留含关键词的文本，相同群内待汇总的重复正文只留一条。普通图片、表情和不含关键词的闲聊直接丢弃。

每个非空批次只请求一次模型，输入只有本批保留的文本、时间及来源，不携带肥鱼聊天历史或工具。模型返回空 items 时不发消息；有用内容合成一条 QQ 私聊，包含事项、价格、截止时间、群和发言者，来源身份由原事件填写。当前均按批次处理，未实现限时福利即时提醒。

数据保存在 data_dir/qq/项目名/group-watch/watch.sqlite。messages.raw 是完整保留事件；batches 中记录状态、模型原响应、usage、摘要和 OneBot 回执。API 没给 usage 时记为 null，不估算 token；这份用量独立于聊天用量面板。可只读查看：

~~~sh
sqlite3 -readonly /absolute/path/watch.sqlite 'SELECT id,state,model,usage,receipt,error FROM batches;'
~~~

模型调用出错或进程中断的批次会保留错误或 calling 状态；发送回执不明的批次保留 sending/send_unknown，不自动再次请求或重发。原消息仍可从数据库核查。这避免重启重复花 token 或重复打扰，但失败批次需要人工处理。没有截断大批输入：若超出所选模型上下文，调用失败会如实记录。

停用时先把 groups 改为空并重启 QQ 实例，既有数据保留。回退二进制前，从旧配置副本恢复 QQ 配置，停稳对应 QQ 进程再切旧版本；不要以旧会话或旧数据库覆盖运行后新增的数据。
