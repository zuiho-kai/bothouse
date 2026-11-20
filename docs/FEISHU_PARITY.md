# 飞书功能对齐盘点（Discord 现有功能在飞书上的支持情况）

来源：用户 11-20「功能统一，现有功能支持飞书」。目标是 Discord 上现有的用户可见功能，飞书上也都能用。
范围只有四个平台：DSH、Discord、飞书、自建网页（cloud-web）。本表只比 Discord 和飞书。

怎么读这份表：

- 一行是一个用户看得见的功能，不是一个接口。一个功能背后有几个 core 可选接口的，合在一行。
- 出处的路径都相对 `bridge/`（仓库根 `docs/` 下的写全）。行号取自分支 `feat/feishu-parity-1821`，11-20 当天核对。
- 接口实现与否来自对 core 83 个平台可选接口的扫描（每个接口在 discord / feishu / cloud-web 的实现位置和 core 断言处），和 `platform/CAPABILITIES.md`、`platform/capability_baseline.txt` 的已有表态对过。
- 「做不做得了」三种：纯代码（飞书开放平台有接口，写代码就能补）、平台不支持（飞书没有对应的东西）、要真机验证（代码能写，但行为要在真实飞书上看过才算数）。
- 飞书官方文档的说法，都是 11-20 当天抓文档页原文核的，链接在第三节。没核到的地方直接写「没核」。

## 一、功能盘点表

| 功能 | Discord 现状 | 飞书现状 | 缺什么 | 做不做得了 | 出处（文件:行） |
| --- | --- | --- | --- | --- | --- |
| 团队派活：bot 之间互相 @、接话 | 有。别的 bot 发的消息只有在白名单（`allow_bots`、`allow_bots_file`）里且 @ 了本 bot 才放行；`Mentioned`、`FromBot` 都填 | 有。别的 bot 的消息只有发送者在 `allow_bots` 里且 @ 了本 bot 才放行；机器人发送者类型 `"app"` 和 `"bot"` 都认；`FromBot`、`Mentioned` 都填；出站用 `mention_map` 把「@名字」转成飞书 at 标签；建工作区群时会拉上 `peer_bots`；手动权限表有「含机器人消息」的权限 | 已补（单测，未真机）：`allow_bots` 白名单、两种发送者类型、权限表加 `im:message.group_at_msg.include_bot:readonly` | 纯代码，要真机验证 | discord：platform/discord/discord.go:849、:1015；飞书：platform/feishu/feishu.go:1363、:1481、:1482、:1130、:345、:1986，platform/feishu/workspaces.go:164；权限表 docs/feishu.md:158-160；旧说明 仓库根 docs/connect-discord-feishu.md:272-278 |
| 团队派活：主和 sub 的判定、干完交回主 | 有。`team_lead_bot` 定主；sub 的最终答复结尾 @ 主；插进正在跑的一轮时保留「主派的活」标记 | 有。`team_lead_bot` 定主；主派的活，sub 的最终答复带上 @ 主；插进正在跑的一轮时保留「主派的活」标记 | 已补（单测，未真机）：`ConfiguredTeamLead`、`ConfiguredTeamLeadSelf`、`FinalReplyMarker`、`InjectedReplyMerger` 四个接口（platform/feishu/lead_return.go） | 纯代码，要真机验证（主 bot 的 id 在别的应用眼里是什么，没核） | discord：platform/discord/discord.go:163，platform/discord/lead_return.go:78、:85、:88，platform/discord/turn_sent.go:132；飞书：platform/feishu/self_mention.go:4；core：core/addressee.go:78、:85，core/backfill.go:90、:106 |
| 工作区频道：建、改名、列出 | 有。工作区是服务器里的频道，统一放「工作区」分类 | 有。工作区是一个群：列 bot 所在的全部群、建群、改群名 | 不缺。飞书没有分类，「放进工作区分类」这一步不适用（见第三节） | 已支持 | discord：platform/discord/workspaces.go:43、:161、:185；飞书：platform/feishu/workspaces.go:77、:146、:166；platform/CAPABILITIES.md:93 |
| 工作区删除、删前归档 | 有。删频道；删之前把整段频道消息读出来打进归档 | 没有。空闲工作区群删不掉，归档里也没有群消息这一段 | `TeamWorkspaceDeleter`（解散群）、`TeamChannelArchiver`（翻页读整段群消息） | 纯代码，要真机验证。解散群要 bot 是群主或创建者；官方原话「解散群组后，群聊天记录将不会保存」 | discord：platform/discord/workspaces.go:77、:106；core：core/team_workspace_delete.go:64，core/team_workspace_cleanup.go:129；已有表态 platform/CAPABILITIES.md:101、:110 |
| 用户要求建新频道（`bothouse channel create`） | 有。建在聊天频道同一分类里，排在「工作区n」上面 | 没有 | `TeamChannelCreator`。建群本身能做（建工作区群的代码可复用），「同分类、排在工作区上面」飞书没有 | 建群：纯代码；排序：平台不支持 | discord：platform/discord/channels.go:25；飞书可复用 platform/feishu/workspaces.go:181；core：core/team_channel.go:50；platform/CAPABILITIES.md:75 |
| 任务板（团队任务板，一条置顶消息） | 有。置顶 embed，原地编辑；换主后旧主把自己的旧板删掉 | 有发板、置顶、原地编辑。换主后旧主先取消置顶再撤回旧板；超过撤回时限的撤不掉，只取消置顶 | 已补（单测，未真机）：`BoardRemover` | 纯代码 | discord：platform/discord/board.go:58、:30；飞书：platform/feishu/public_progress.go:95、:130、:264、:280、:296；core：core/team_board.go:424、:191 |
| 频道任务看板（每个频道一条置顶：在跑的、排队的、今天做完的） | 有 | 有。每个群一张置顶卡片，原地编辑；卡片被撤回或超过 14 天改不动就重发一张；重启后先在群置顶里、再在最近 50 条里按卡片底部的 `cc-board` 标记找回自己那张。时间写成「15:04」，没有 Discord 那种「3 分钟前」 | 已补（单测，未真机）：`ChannelBoardPoster`；core 的看板从只认 Discord 改成 Discord、飞书各发各的 | 纯代码，要真机验证（卡片编辑和 Pin 列表的实际表现） | discord：platform/discord/channel_board.go:48；飞书：platform/feishu/channel_board.go:51、:66、:82、:91；core：core/channel_board.go:135、:299 |
| 任务卡、任务子话题里的事实楼层 | 有。任务卡下开子区，关键事实发进子区 | 有。任务卡是卡片消息，事实用「话题回复」挂在卡片下面 | 不缺 | 已支持 | discord：platform/discord/public_progress.go:27、:65、:279；飞书：platform/feishu/public_progress.go:29、:45、:72、:215 |
| 任务子话题的归档、重开 | 有。任务做完把子区归档，有新事实再重开，按最后活动时间决定何时归档 | 没有 | `TaskThreadArchiver`、`TaskThreadReopener`、`TaskThreadActivityReader` | 平台不支持（没核到飞书有归档话题的接口，官方也没有明写「不支持」）。不补不影响用，话题一直留着 | discord：platform/discord/public_progress.go:188、:220、:242；core：core/public_progress.go:846、:946、:827 |
| 任务帖（论坛频道，每件活一个帖子，带状态标签；等你拍板时在帖里提醒；在帖里回复能回到原频道会话） | 有 | 没有。任务进度由上面的任务卡展示 | `TaskForumPoster`、`TaskForumUserNotifier`、`ChannelSessionKeyer` | 平台不支持（飞书群没有论坛频道和帖子标签） | discord：platform/discord/task_forum.go:43、:371，platform/discord/live_options.go:91，platform/discord/task_forum_inbound.go:17；core：core/team_task_forum.go:729；platform/CAPABILITIES.md:151、:159、:167 |
| 进度卡（一轮里每一步在干什么） | 有。可按 bot 配卡片条数、每行长度、藏不藏思考；编辑有限速 | 有卡片样式、结构化进度卡、流式预览和原地更新。按 bot 配条数、行长、藏思考已补，选项名和 Discord 一样（`progress_card_entries`、`progress_line_len`、`progress_hide_thinking`），不配就和原来一样；编辑最快每 0.2 秒一次 | 已补（单测，未真机）：`ProgressCardSizer`、`ProgressUpdateThrottler` | 纯代码 | discord：platform/discord/discord.go:296、:309、:313、:1617；飞书：platform/feishu/progress_size.go:27、:28；core：core/progress_compact.go:355、:352 |
| 进度卡同步进任务子话题（点开任务就看到每一步） | 有 | 没有。飞书任务卡不填话题 id，core 找不到往哪发 | `TaskThreadTarget`，并先让飞书任务卡把话题根消息 id 记到任务上 | 纯代码，要真机验证（话题里的卡片能不能原地编辑） | discord：platform/discord/task_thread_progress.go:9；core：core/task_thread_progress.go:67；platform/CAPABILITIES.md:39 |
| 子 agent 表（一轮里开了哪些子 agent、各自状态） | 有。表被聊天顶上去后会在底部重发 | 没有，飞书上看不到这张表 | `SubTaskTablePayloadSupport`（渲染成卡片）、`LatestMessageChecker`（要先有历史读取） | 纯代码 | discord：platform/discord/subtasks.go:18、:27；core：core/subtasks.go:188、:206 |
| 引用回复（回复某条消息，bot 知道回的是哪件活） | 有 | 有。入站把被回复消息 id 填进 Reference，出站登记每条发出消息的 id | 不缺 | 已支持 | discord：platform/discord/discord.go:932，platform/discord/turn_sent.go:123；飞书：platform/feishu/feishu.go:1121（Reference 在 :1133）、:3783；core：core/reply_task.go:145；platform/CAPABILITIES.md:12、:21 |
| 私信 `send --dm`、`--dm --to <id>` | 有。开私聊；`--to` 先核对方在不在本服务器；对方拒收私信时改开一个只有他能看的私密子区 | 有开私聊、`--to` 核对方在不在当前群、认出拒收。没和机器人聊过的人，第一次要先按 open_id 发一条「私信」两个字的消息换出单聊。拒收时没有私密子区兜底，直接报发不出 | 已补（单测，未真机）：`DirectMessageOpener`、`DMMemberChecker`、`DMRefusalDetector`；私密子区飞书没有 | 前三个：纯代码，要真机验证；私密子区：平台不支持 | discord：platform/discord/discord.go:1671、:1690、:1736、:1747；飞书：platform/feishu/dm.go:51、:98、:125；core：core/dm.go:102、:156、:34、:48；platform/CAPABILITIES.md:127、:135、:143 |
| 按名字发频道 `send --channel <名字>` | 有。只在当前对话所在的服务器里按名字找，重名或找不到就报错、不发 | 有。飞书没有「服务器」，在 bot 所在的全部群里按群名找（没名字的群不算），重名或找不到就报错、列候选、不发；发完回显发到了哪个群 | 已补（单测，未真机）：`GuildChannelLister`、`ChannelNameResolver` | 纯代码，语义变了（从「同服务器」变成「bot 在的所有群」），要真机验证 | discord：platform/discord/channel_names.go:18，platform/discord/discord.go:2001；飞书：platform/feishu/channel_names.go:25、:43，platform/feishu/workspaces.go:119；core：core/send_channel.go:83；platform/CAPABILITIES.md:84 |
| 发图片、发文件 | 有 | 有 | 不缺 | 已支持 | discord：platform/discord/discord.go:1441、:1495；飞书：platform/feishu/feishu.go:2918、:2966；core：core/engine.go:13639、:13657 |
| 发语音、TTS 念出来 | 有。语音消息 | 有。音频消息 | 不缺 | 已支持 | discord：platform/discord/voice_message.go:32；飞书：platform/feishu/feishu.go:4976；core：core/tts.go:69，core/engine.go:14042 |
| 发视频 | 没有单独的视频发送，按文件发 | 有。原生视频消息 | 不缺，飞书比 Discord 全 | 已支持 | 飞书：platform/feishu/feishu.go:5053；core：core/tts.go:82，core/engine.go:14086 |
| 频道历史回看（bot 补读自己没看到的聊天；历史接口给脚本用；区分哪些是 bot 自己的话、哪些是系统通知） | 有 | 没有。飞书只能按 id 取单条消息和顺着回复链往上取 | `ChannelHistoryReader`，连带 `AgentReplyMarker`、`SessionAgentReplyMarker`、`SystemNoticeMarker` | 纯代码，要真机验证。官方有「获取会话历史消息」接口，bot 要在群里；普通群按群取只拿得到话题的根消息 | discord：platform/discord/discord.go:1934，platform/discord/turn_sent.go:141、:160，platform/discord/aux_channels.go:114；飞书现有：platform/feishu/feishu.go:2115、:2285；core：core/backfill.go:216，core/api_history.go:101 |
| 斜杠命令 | 有。把命令注册进 Discord 原生的 / 菜单，输入 / 有提示 | 打字发「/命令」照常能用。单聊里的机器人菜单，点一下当成一条命令。没有输入 / 的提示 | `CommandRegistrar`（原生注册） | 平台不支持（飞书机器人菜单只能在开发者后台手配，且只在单聊出现） | discord：platform/discord/discord.go:655；飞书：platform/feishu/feishu.go:5199；core：core/engine.go:3327 |
| 定时任务回帖 | 有。回到原频道；开了话题隔离时，每次定时任务新开一个子区 | 有。回到原群或原话题；开了话题隔离（`thread_isolation`）时，每次定时任务先在群里发一条标题消息，再在它的话题里回；单聊不开话题，回原会话 | 已补（单测，未真机）：`CronReplyTargetResolver` | 纯代码，要真机验证 | discord：platform/discord/discord.go:1784、:613；飞书：platform/feishu/cron_target.go:30，platform/feishu/feishu.go:3979；core：core/interfaces.go:100，core/engine.go:1930、:2284 |
| 会议助手、语音频道（@bot 开会，bot 进语音频道听，结束后出纪要）、语音台交接 | 有。bot 进语音频道收音频，本机转写，结束时把转写稿交给 agent 出纪要 | 没有 | 整条都缺。飞书有「智能体入会」接口：用 9 位会议号入会、轮询会中事件、发会中消息、离会。会中事件里的「发言」带字幕文字，但拿不到原始音频 | 纯代码，要真机验证（细节见第三节「会议」） | discord：platform/discord/meeting.go:178、:197、:498，platform/discord/meeting_listener.go:100，platform/discord/self_mention.go:29；core：core/voice_desk.go:370 |
| 停、插话 | 有。`/stop all` 不用 @ 就到每个 bot；只发一个「停」字（没 @ 谁、没回复谁）也到每个 bot；说话能插进正在跑的一轮 | 有。`/stop all` 免 @；只发一个「停」字（纯文本、没 @ 谁、不是回复、不在话题里）也到每个 bot，标成全群停；插话走 core | 已补（单测，未真机）：只发停字免 @ | 纯代码 | discord：platform/discord/discord.go:927、:929、:1019，platform/discord/reply_routing.go:52；飞书：platform/feishu/feishu.go:1491、:6907；core：core/gate.go:817，core/stop_all.go:38 |
| 表情回应（收到贴一个表情，做完或出错换一个） | 有（`TurnReactor`，可开关） | 有自己的一套：`reaction_emoji` 收到时贴、结束时撤，`done_emoji` 做完贴 | 不缺。出错时贴不贴「失败」表情，没核 | 已支持（不再接 `TurnReactor`，接了会重复） | discord：platform/discord/ack_reaction.go:115；飞书：platform/feishu/feishu.go:302、:309、:975、:988；platform/CAPABILITIES.md:184 |
| 平台事件触发器（进出群、别人贴表情、频道建删、子区、语音进出、置顶） | 有，11 种事件 | 有 5 种：表情加、表情撤、成员进群、成员退群、群解散 | 建群、新开话题、置顶变化、语音进出四类事件 | 语音进出：平台不支持（群里没有语音频道）；其余三类：没核飞书有没有对应事件 | discord：platform/discord/events.go:13；飞书：platform/feishu/events.go:14、:70、:78、:98、:105、:112；core：core/member_events.go:25-35 |
| 权限审批（点按钮允许或拒绝）、指定别人代批 | 有。按钮消息；可配哪些身份能代批 | 有卡片按钮。没有代批 | `PermissionDelegationPlatform` | 纯代码 | discord：platform/discord/discord.go:1577，platform/discord/permission_delegation.go:43；飞书：platform/feishu/card.go:38、:58；core：core/engine.go:11763-11767，core/permission_delegation.go:26 |
| 工作区静音（工作区里的消息不推送通知） | 有 | 没有 | `SilentChannelAware` | 没核。没查到飞书发消息有「不通知」的参数 | discord：platform/discord/silent.go:31；core：core/engine.go:3143 |
| 运行维护：改配置不重启就生效、断线后自己恢复 | 有 | 没有。改飞书选项要重启桥；断线恢复没核飞书长连接自己会不会重连 | `OptionsReloader`、`AsyncRecoverablePlatform` | 纯代码 | discord：platform/discord/live_options.go:61，platform/discord/discord.go:734；core：core/engine.go:1452、:2148 |

表共 29 行。飞书已完整支持 7 行（工作区建改列、任务卡与事实楼层、引用回复、发图发文件、发语音、发视频、表情回应）；其余 22 行有缺口，其中任务板、进度卡、斜杠命令、定时回帖、停和插话、平台事件、权限审批这几行主体能用，只缺一部分。有缺口的 22 行里，6 行的缺口已补（单测，未真机）：bot 之间互相 @、主和 sub 交回、任务板「换主后删旧板」、私信（私密子区兜底除外，平台不支持）、按名字发频道、定时任务每次新开话题。真机验过再算进完整支持，所以上面的 7 和 22 先不动。

飞书有、Discord 没有的（不算缺口，列出来免得误删）：原生视频消息（feishu.go:5053）、消息撤回感知（feishu.go:1058）、富文本卡片和表格拆分（feishu.go:6805、:6810）、状态脚注（feishu.go:2896）、卡片翻页（feishu.go:279）。

## 二、缺口按常用程度排序

排序依据：团队派活、私信、任务板这三类是每天都在用的，排前面；其余按「不补用户会不会撞上」往后排。行数是代码加单测的粗估，参照 Discord 侧同功能文件的大小。

1. **bot 之间互相 @ 派活（入站放行）** —— 已补（单测，未真机）
   - 单测：platform/feishu/lead_return_test.go 的 `TestSenderIsBotAcceptsAppAndBot`、`TestOnMessageAllowedBotMentioningSelfGetsIn`、`TestOnMessageDropsOtherBotMessages`、`TestTeamOptionsParsed`。下面是补之前写的方案，留作对照。
   - 补法：飞书入站认两种机器人发送者类型（`"app"` 和 `"bot"`）；加 `allow_bots` 白名单，名单外的机器人消息丢掉，名单内的也要 @ 了本 bot 才放行；权限表加 `im:message.group_at_msg.include_bot:readonly`。
   - 要动的文件：platform/feishu/feishu.go（选项解析 :313 一带、onMessage :1363、isStopAllEvent :6850）、docs/feishu.md（权限表 :158）、仓库根 docs/connect-discord-feishu.md（:272-278 的旧说法要改）。扫码向导自动申请的权限清单在哪个文件，没核到（按权限串在 bridge 的 go 文件里没搜到）。
   - 预估：代码约 80 行，单测约 60 行。
   - 风险：白名单没配好，两个 bot 互相 @ 会打转；`sender_type` 的真实取值没在真机上见过，文档和旧版 SDK 注释说法不一致（SDK 注释还写着「目前只支持用户发送的消息」）。
   - 要真飞书验证：要。至少两个应用进同一个群，互相 @ 一次。

2. **主和 sub 的判定、干完交回主** —— 已补（单测，未真机）
   - 单测：platform/feishu/lead_return_test.go 的 `TestConfiguredTeamLead`、`TestOnMessageMarksLeadDispatch`、`TestFinalReplyReturnsToLead`、`TestMergeInjectedReplyKeepsLead`。下面是补之前写的方案，留作对照。
   - 补法：加 `team_lead_bot` 选项；实现 `HasConfiguredTeamLead`、`IsConfiguredTeamLead`；sub 的最终答复结尾带上 @ 主（`MarkFinalReply`）；插话时保留「主派的活」标记（`MergeInjectedReply`）。
   - 要动的文件：新增 platform/feishu/lead_return.go；platform/feishu/feishu.go（replyContext :118 一带加「是主派的」字段、发送处拼 at 标签）。参照 platform/discord/lead_return.go（132 行）和 platform/discord/turn_sent.go（173 行）。
   - 预估：代码约 180 行，单测约 100 行。
   - 风险：依赖第 1 条先通；飞书里同一个用户在不同应用下的 open_id 不同（官方「发送消息」文档原话），机器人的 id 是不是也这样没核，`team_lead_bot` 该填 app_id 还是 open_id 要真机定。
   - 要真飞书验证：要。

3. **私信 `send --dm`、`--dm --to`** —— 已补（单测，未真机）
   - 做法：`OpenDM`（platform/feishu/dm.go:51）返回单聊会话键「平台:单聊 chat_id:open_id」，和这个人私聊机器人时入站消息的键是同一个，所以他回的话接得上。单聊的 chat_id 机器人只能从「按 open_id 发一条消息」的响应里拿，所以对没和机器人聊过的人，第一次会先发一条「私信」两个字的消息；聊过的人（入站单聊消息里记下了 chat_id）和第二次起不再发。记在内存里，桥重启后重新来一次。
   - `--to` 核对：`IsDMMember`（dm.go:98）列当前群的成员找这个人（翻页）；收件人就是当前对话的发言人时不用查；当前对话不是飞书会话就报错、不发。
   - 拒收：`IsDMRefused`（dm.go:125）认 230013（对方不在应用可用范围）和 230053（对方不让机器人给他发消息）。飞书没有私密子区，认出来后不改道，报发不出；core 这句报错里写的还是「Discord refused the DM」，没改。
   - 单测：platform/feishu/dm_test.go 的 `TestFeishuOpenDMUsesP2PChatSessionKey`、`TestFeishuOpenDMNeedsChatID`、`TestFeishuIsDMMember`、`TestFeishuIsDMRefused`。
   - 要真飞书验证：要。没验过的有三处：按 open_id 发消息的响应里 chat_id 是不是单聊的；两个拒收错误码真机上长什么样；机器人列单聊成员会不会被拒（从别人的单聊里 `--to` 第三个人时会走到）。

4. **任务板收尾：换主后删旧板** —— 已补（单测，未真机）
   - 做法：`RemoveBoard`（platform/feishu/public_progress.go:130）先取消置顶，再调「撤回消息」撤掉自己发的那张板；消息已不在（错误码 230110、230011）算删成功。
   - 撤不掉时：飞书拒绝且重试也没用的（比如超过撤回时限，错误码 230009）报「不可恢复」，core 不再重试；这时旧板已经从置顶列表里拿掉，消息本身还留在群里。
   - 单测：platform/feishu/public_progress_test.go 的 `TestFeishuRemoveBoard*` 三个用例（删对 id 且取消置顶、已删算成功、超撤回时限报不可恢复）。
   - 没核的：真飞书上取消置顶和撤回的实际返回、机器人撤回自己消息的时限是多久。
   - 要真飞书验证：建议。

5. **频道任务看板（每频道一条置顶）** —— 已补（单测，未真机）。合并间隔沿用 Discord 的 2 秒（飞书同一条消息限 5 次每秒）。真机没核：按 user_card_content 读回的卡片 JSON 是否原样带着 `cc-board` 标记、群设置「仅群主可置顶」时置顶失败的错误码。
   - 补法：实现 `ChannelBoardPoster` 四个方法：发卡片、编辑卡片、Pin、用「获取群内 Pin 消息」找回原来那条。
   - 要动的文件：新增 platform/feishu/channel_board.go；卡片渲染可复用 platform/feishu/public_progress.go:293 的 buildFeishuBoardCard。参照 platform/discord/channel_board.go（257 行）。
   - 预估：代码约 200 行，单测约 100 行。
   - 风险：看板改得勤，飞书卡片编辑的限速没核，可能要配合第 9 条的限速一起做。
   - 要真飞书验证：要。

6. **进度卡同步进任务子话题**
   - 补法：飞书任务卡发出后把卡片消息 id 记成任务的话题 id；实现 `TaskThreadReplyCtx`，返回「回复到这条卡片的话题里」的上下文。
   - 要动的文件：platform/feishu/public_progress.go（:45 EnsureTaskCard、:215 replyInThread）；新增 platform/feishu/task_thread_progress.go。
   - 预估：代码约 80 行，单测约 60 行。
   - 风险：话题里的进度卡能不能原地编辑没验过（CAPABILITIES.md:39 已写明这一点）。
   - 要真飞书验证：要。

7. **频道历史回看** —— 已补（单测，未真机）。真机没核：飞书 om_ id 是否按时间有序（已改按 create_time 比，不依赖它）、bot 自己消息的 sender.id 是否等于 app_id、需 im:message.group_msg 权限且 bot 在群里；普通群按群读只拿到话题根消息。
   - 补法：实现 `ChannelHistory`，调「获取会话历史消息」按群翻页，转成 core 的历史消息；出站时记下哪些是 agent 自己的话（`MarkAgentReply`），补读时好过滤。
   - 要动的文件：新增 platform/feishu/history.go；platform/feishu/feishu.go（消息内容解析复用 :2115 fetchSingleMessage 的那套）。参照 platform/discord/discord.go:1934-2000、platform/discord/turn_sent.go:141。
   - 预估：代码约 150 行，单测约 80 行。
   - 风险：普通群按群取只拿得到话题根消息，话题里的回复要另按话题取；要「获取群组中所有消息」这类读群消息的权限（docs/feishu.md:160 已列，属敏感权限）。
   - 要真飞书验证：要。

8. **按名字发频道 `send --channel`** —— 已补（单测，未真机）。官方文档写明群列表不含单聊，要 `im:chat` 或 `im:chat:readonly`（docs/feishu.md:360 已列）。真机没核：外部群、话题群是否都列得出来；按 `<平台>:<群 id>` 这种不带用户的会话键主动发消息在真群里的表现。顺带的变化：飞书能报群名后，多工作区模式（multi-workspace）下没绑定的飞书群也会像 Discord 一样按群名去对 base_dir 下的同名目录；群名不是普通目录名（带 `/`、`..`）的不对（core/engine.go:19614）。
   - 补法：实现 `GuildMessageChannels`，返回 bot 所在的全部群（复用列群）；实现 `ResolveChannelName`。
   - 要动的文件：platform/feishu/workspaces.go（:77 一带）；core/send_channel.go（:86 的报错写死了「Discord only」，重名提示写死了「本服务器」，要改措辞）。
   - 预估：代码约 50 行，单测约 40 行。
   - 风险：Discord 版限定「同一服务器」就是为了防发错地方（用户 11-11「我说转给jiuwen，怎么转到这来了」）；飞书没有服务器，范围变成 bot 在的所有群，重名和发错的机会更大。动了 core，属于一次动两个组件。
   - 要真飞书验证：建议。

9. **进度卡尺寸和编辑限速、子 agent 表** —— 尺寸和限速已补（单测，未真机）；子 agent 表没补。限速取飞书「同一条消息每秒最多改 5 次」，即 0.2 秒一次：飞书改卡片这条路原来没有限速处理，一串工具事件连发会被回 230020。
   - 补法：`ProgressCardSizer` 读每个 bot 的卡片条数、行长、藏思考三个选项；`ProgressUpdateThrottler` 给一个编辑间隔；`SupportsSubTaskTablePayload` 把子 agent 表渲染成卡片。
   - 要动的文件：platform/feishu/feishu.go（:448 一带）；新增 platform/feishu/subtasks.go。参照 platform/discord/subtasks.go（233 行）。
   - 预估：尺寸和限速约 40 行，子 agent 表约 120 行，单测约 80 行。
   - 风险：小。子 agent 表「被顶上去后在底部重发」要等第 7 条的历史读取。
   - 要真飞书验证：建议（看卡片排版）。

10. **只发一个「停」字免 @** —— 已补（单测，未真机）。和 Discord 一样要群里能收到没 @ 机器人的消息，也就是「获取群组中所有消息」权限；没这个权限飞书根本不推这条消息过来。
    - 补法：入站对「没 @ 任何人、不是回复、内容只是停字」的用户消息放行，并标成 StopAll。
    - 要动的文件：platform/feishu/feishu.go（:1442 的放行分支、:6850 isStopAllEvent）。参照 platform/discord/reply_routing.go:52。
    - 预估：代码约 25 行，单测约 30 行。
    - 风险：小。要有「获取群组中所有消息」权限才收得到没 @ 的消息。
    - 要真飞书验证：建议。

11. **工作区删除、删前归档**
    - 补法：`DeleteTeamWorkspaceChannel` 调「解散群」；`TeamChannelMessages` 复用第 7 条的历史读取，把整段群消息读出来。
    - 要动的文件：platform/feishu/workspaces.go。参照 platform/discord/workspaces.go:77、:106。
    - 预估：代码约 90 行，单测约 60 行。
    - 风险：解散群后聊天记录不保存，撤不回；bot 必须是群主，或是创建者且开了 `im:chat:operate_as_owner`。platform/CAPABILITIES.md:101 现在写的是「按 #1904 的设计，桥不提供删除实现」，要补得先改这条表态。
    - 要真飞书验证：要。

12. **会议助手**
    - 补法：口令「@bot 开会 <9 位会议号>」入会；按游标轮询会中事件，把「发言」事件里的字幕文字按发言人攒成转写稿；「结束」或会议散了就离会，把转写稿交给 agent 出纪要。转写稿格式和纪要提示词从 Discord 侧搬到 core 共用。
    - 要动的文件：新增 platform/feishu/meeting.go；platform/feishu/feishu.go（入站口令入口）；core 新增一个放转写稿格式和提示词的文件；platform/discord/meeting.go（:498 那两个函数挪走）。参照 platform/discord/meeting.go（549 行）。
    - 预估：代码约 350 行，单测约 150 行。
    - 风险：新接口，没人在本项目里用过；轮询限 100 次每分钟；每场会议都要主持人手动开「AI 总结」和「允许智能体加入会议」；字幕质量由飞书决定，本机换不了转写模型。动了 core 和两个平台。
    - 要真飞书验证：要。要一场多人会议和 7.68 以上的客户端。

13. **权限代批**
    - 补法：实现 `PermissionDelegationPlatform` 三个方法，从配置读能代批的身份。
    - 要动的文件：新增 platform/feishu/permission_delegation.go。参照 platform/discord/permission_delegation.go（76 行）。
    - 预估：代码约 80 行，单测约 50 行。
    - 风险：小。
    - 要真飞书验证：建议。

14. **定时任务每次新开话题、改配置不重启、断线恢复** —— 定时任务每次新开话题已补（单测，未真机）；另两项没动。真机没核：bot 对自己刚发的标题消息做话题回复是否真的开出话题、用户在这个话题里回复时 root_id 是否等于标题消息 id（会话接不接得上靠它）、话题群里的表现。
    - 补法：`ResolveCronReplyTarget` 先发一条根消息再回到它的话题里；`ReloadOptions` 让一部分选项热生效；`SetLifecycleHandler` 没核飞书长连接现状，先查再定。
    - 要动的文件：platform/feishu/feishu.go；新增 platform/feishu/live_options.go。参照 platform/discord/live_options.go（93 行）。
    - 预估：三项合计代码约 200 行，单测约 100 行。
    - 风险：都不是用户天天撞上的，排最后。
    - 要真飞书验证：定时开话题要；另两项建议。

不补的（写明原因，免得后面重复讨论）：

- 交回细节放进正文下的子话题（`DetailThreadSender`）：细节 10-30 起已经不发给用户，这条路现在不走（platform/CAPABILITIES.md:30）。
- 表情回应再接一套 `TurnReactor`：飞书已有 `reaction_emoji` 和 `done_emoji`，再接会重复（platform/CAPABILITIES.md:184）。
- 排队提示（`QueueReporter`）：Discord 自己也没有，不属于「Discord 现有功能」（platform/CAPABILITIES.md:48）。

## 三、飞书平台做不到的

下面每条都是飞书没有对应的东西，不是代码没写。链接是 11-20 核对时抓的官方文档页（文档站地址 = `https://open.feishu.cn/document/` 加文档路径）。

1. **论坛频道和帖子标签（任务帖）**。飞书的群只有普通群和话题群，没有「论坛频道 + 每帖一个状态标签」。能替代的是现在的做法：任务卡加话题回复。回复消息接口的 `reply_in_thread`：https://open.feishu.cn/document/server-docs/im-v1/message/reply 。没核到官方有「不支持论坛」的明文，结论来自开放平台消息和群组接口里没有这类对象。

2. **服务器、分类、频道排序**。飞书没有「服务器 → 分类 → 频道」这一层，bot 能看到的就是它所在的一个个群。所以「工作区统一放一个分类」「新频道排在工作区上面」「在同一个服务器里按名字找频道」都没有原样对应。代码里的说明：platform/feishu/workspaces.go:75-76。

3. **原生斜杠命令注册**。飞书没有让机器人注册 / 命令的接口。最接近的是机器人菜单，官方原话「目前，机器人菜单仅支持单聊场景，不支持群聊场景」，而且只能在开发者后台手配、发版后才生效。https://open.feishu.cn/document/client-docs/bot-v3/bot-customized-menu

4. **只有一个人能看的私密子区（私信被拒时的兜底）**。飞书群里没有私密话题。最接近的是「仅特定人可见的消息卡片」，只能是卡片、只在群里、是临时交互用的，当不了一个能来回聊的私密会话。https://open.feishu.cn/document/ukTMukTMukTM/uETOyYjLxkjM24SM5IjN

5. **列出群里有哪些机器人**。「获取群成员列表」官方原话「该接口不会返回群组内的机器人成员」。所以飞书上 @ 队友 bot 不能靠查群成员，只能靠手配的 `mention_map`（docs/feishu.md:372）。https://open.feishu.cn/document/server-docs/group/chat-member/get

6. **会议里的原始音频**。飞书「智能体入会」这组接口只给事件，不给音频流，Discord 那种「bot 进语音频道收音频、本机转写」做不了。能做的见下面「会议」。

7. **语音频道进出事件**。飞书群里没有常驻的语音频道，没有「谁进了语音」「谁离开语音」这类群事件。

8. **任务子话题归档**。没核到飞书有归档或隐藏一个话题的接口。按「平台不支持」处理，话题一直留着，不影响任务卡和事实楼层。

### 会议：飞书能做到哪一步

飞书现在有「视频会议 / 智能体」这组接口，机器人能作为独立参会者进会：

- 入会：`POST /open-apis/vc/v1/bots/join`，用 9 位会议号，权限 `vc:meeting.bot.join:write`，限 5 次每秒。返回长的 `meeting_id`，后面都用它。
- 取会中事件：`GET /open-apis/vc/v1/bots/events`，限 100 次每分钟，靠 `page_token` 游标接着取。事件子类型有六种：`participant_joined`、`participant_left`、`transcript_received`、`chat_received`、`magic_share_started`、`magic_share_ended`。
- 发会中消息：`POST /open-apis/vc/v1/bots/message`，限 100 次每分钟。离会：`POST /open-apis/vc/v1/bots/leave`。
- **「发言」事件带转写文字**。子类型 `transcript_received` 的 `transcript_received_items` 每项有：`speaker`（发言人，含 id、user_name）、`text`（字幕文本）、`language`、`start_time_ms`、`end_time_ms`、`sentence_id`（句子 id，用来去重和排序）。也就是说纪要要用的「谁在什么时候说了什么」直接拿得到，不用本机转写。
- 前提：飞书客户端 7.68 及以上；每场会议要主持人在会中开「AI 总结」，并在「安全」里确认「允许智能体加入会议」已开。
- 限制：没有取原始音频流的接口；事件推送（`vc.bot.meeting_activity_v1` 等三个事件）官方写明「已暂缓对三方增量接入开放」，新接入只能主动入会加轮询。

链接：

- 使用指南：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/vc-v1/bot/user-guide/agent-meeting-user-guide
- 加入会议：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/vc-v1/bot/join
- 获取会议事件列表：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/vc-v1/bot/events

### 不是平台限制、容易被当成平台限制的

**飞书机器人收得到别的机器人发的群消息**，这一条是权限问题，不是平台不支持。「接收消息」事件（`im.message.receive_v1`）官方原话：

- 首句：「机器人接收到用户/机器人发送的消息后触发此事件」。
- 「接收群聊中用户及群内机器人 @ 当前机器人的消息：需具备 获取群组中其他机器人和用户@当前机器人的消息（`im:message.group_at_msg.include_bot:readonly`）权限」。
- 「接收群聊中所有用户和其他机器人发送的消息：需具备 获取群组中用户和机器人消息（`im:message.group_msg.include_bot:read`）权限，不包含当前机器人自己发送的消息」。
- 「可以通过 sender_type 字段来区分消息发送者是 user 还是 bot」，字段说明写的取值是 `"user"` 或 `"bot"`。

链接：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive

对照代码：入站 platform/feishu/feishu.go:1363 的 onMessage 没有丢机器人消息的分支，:1482 把 `sender_type=="app"` 记成 FromBot。所以「团队派活 bot 之间互相 @」在飞书是纯代码能补的，差的是权限、白名单和发送者类型的取值。仓库根 docs/connect-discord-feishu.md:272-278 写的「`mentioned` 只有 Discord 填」「bot 之间不会互相接话」已经过时一半：`Mentioned` 和 `FromBot` 飞书现在都填了（feishu.go:1128-1130），剩下没有的是 `allow_bots` 和 `team_lead_bot`。

其它核过、确认有接口的：

- 给个人发消息（私信）：发送消息接口支持 `receive_id_type=open_id`，前提是「用户需要在机器人的可用范围内」。https://open.feishu.cn/document/server-docs/im-v1/message/create
- 读群历史：「获取会话历史消息」，前提「机器人必须在被查询的群组中」。https://open.feishu.cn/document/server-docs/im-v1/message/list
- 解散群：bot 是群主，或是创建者且开了 `im:chat:operate_as_owner`；「解散群组后，群聊天记录将不会保存」。https://open.feishu.cn/document/server-docs/group/chat/delete
- 撤回消息：「机器人可以撤回该机器人自己发送的消息」。https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/delete
- Pin 和列出 Pin：https://open.feishu.cn/document/server-docs/im-v1/pin/create 、https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/pin/list

## 四、没核的地方

- 飞书事件里机器人发送者的 `sender_type` 真实取值是 `"app"` 还是 `"bot"`：文档写 `"bot"`，代码认 `"app"`，没在真机上见过。
- 别的应用眼里，一个机器人的 open_id 是不是和它自己看到的一样。
- 扫码向导（`bothouse feishu setup`）自动申请了哪些权限：清单位置没找到，只核了手动权限表 docs/feishu.md:158-160。
- 飞书卡片编辑的限速、撤回自己消息有没有时限、发消息有没有「不通知」参数、长连接断了会不会自己重连、出错时贴不贴失败表情。
- 飞书有没有「建群」「新开话题」「Pin 变化」这三类事件可订阅。

真机状态：飞书测试号未建（开放平台需手机扫码登录），以下补项只有单测和模拟回放
