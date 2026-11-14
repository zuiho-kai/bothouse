# 平台能力表

我们支持的平台只有四个：DSH、Discord、飞书、自建网页（cloud-web）。本表只写这四个。

DSH 没有自己的平台目录：DSH 的房间经它的 collab 网关（dsh/collab/cloudweb.mjs）接到 cloud-web 平台，所以 DSH 的能力和 cloud-web 一样。

检查：bridge/platform_parity_test.go（在 bridge/ 下跑 `go test -tags no_web -run TestPlatformCapabilityParity .`）。
能力 = core 用类型断言检查、四个平台里至少一个实现了的接口（内联匿名接口记作 `anon:<方法名>`），外加 Message.Reference。
每一节「## <能力>」下写「- <平台>: 已接」或「- <平台>: 不支持：<原因>」。
本表没写的缺口要在 platform/capability_baseline.txt 里（旧账，只许删行）；SentMessageRecorder 和 Message.Reference 不许进基线，四个平台都要在这里表态。

## Message.Reference

入站「这条消息回复的是哪一条」：平台把被回复消息的 id（有的还带作者、原文）填进 core.Message.Reference，core 据此找到那条消息属于哪件活（core/reply_task.go）。

- discord: 已接
- feishu: 已接
- cloud-web: 已接
- dsh: 已接

## SentMessageRecorder

出站登记：平台把每条发出消息的 id 交给 core，以后用户回复这条时 core 认得它属于哪件活。

- discord: 已接
- feishu: 已接
- cloud-web: 已接
- dsh: 已接

## DetailThreadSender

工作区交回时，正文发到聊天频道、细节放进正文下的子话题（core/team_exit.go postWorkspaceExit）。10-30 起细节不再发给用户（postReportDetail=false），这条路目前不走；没接的平台退回到「正文后再发一条细节」。

- discord: 已接
- feishu: 不支持：细节已停发，飞书的话题回复要先拿到第一条消息的 id 再 reply_in_thread，没有真实飞书环境验证前不接；细节恢复时再接
- cloud-web: 不支持：Channels 没有子话题，只能顺着发第二条，就是 core 的默认退路
- dsh: 不支持：同 cloud-web

## TaskThreadTarget

工作区每一步的进度卡复制进任务卡的子话题（core/task_thread_progress.go）。core 按 Task.ThreadID 找子话题。

- discord: 已接
- feishu: 不支持：飞书任务卡的事件是对卡片消息的话题回复，不填 Task.ThreadID，进度卡也不能在话题里原地编辑；要接得先给飞书任务卡填话题 id 并在真实飞书上验证
- cloud-web: 不支持：Channels 没有任务子话题（PublishTaskFact 也是空实现），进度只在卡片本身
- dsh: 不支持：同 cloud-web

## QueueReporter

把会话里排在当前这一轮后面的用户消息报给平台，页面显示「排队 N 条」并可撤回（core/queue_report.go，#1020）。cloud-web 只在 gateway 列出 queue 能力时发 queue 帧。

- cloud-web: 已接
- dsh: 已接
- discord: 不支持：Discord 没有给机器人在输入框或消息上挂「排队中」标记的地方，只能另发消息，会刷屏；排队消息照旧可删原消息撤回
- feishu: 不支持：同 discord，飞书也没有输入状态旁的提示位，只能另发消息

## PlatformNoticer

平台有要用户去修的事时，面板角色页在该平台下显示一行提醒（core/member_events.go，#1058）；Discord 用它提醒没开 Server Members Intent。平台事件（进群、表情回应、频道、语音、置顶）的平台支持见 docs/usage.zh-CN.md「平台事件触发器」。

- discord: 已接
- feishu: 不支持：飞书没有成员进群事件这条线，暂无要提醒的平台权限；成员事件按交接「飞书暂不做」
- cloud-web: 不支持：本机网页频道没有平台侧权限开关，没有要提醒的事
- dsh: 不支持：同 cloud-web

## PlatformEventSource

平台把服务器上发生的事（进出群、表情回应、频道建删、子区、语音进出、置顶）交给 core 发成事件：写 events.jsonl，触发同名 [[hooks]]，可按服务器/频道/用户过滤（core/member_events.go，#1061）。事件表见 docs/usage.zh-CN.md「平台事件触发器」。

- discord: 已接
- feishu: 已接
- cloud-web: 不支持：本机网页频道没有成员、表情、语音这些平台侧事件可上报
- dsh: 不支持：同 cloud-web，DSH 房间经 collab 网关只转消息

## TeamChannelCreator

`bothouse channel create <名字>`：在聊天频道同一分类里建用户要的新频道，并排到该分类的「工作区n」上面（core/team_channel.go，用户 11-09「用户要求创建的新频道统一放到工作区上面」）。

- discord: 已接
- feishu: 不支持：飞书没有服务器分类和频道排序，新建的是群聊，工作区也不是飞书频道
- cloud-web: 不支持：本机网页频道的房间由 collab 网关管，没有给角色建房间和排序的接口
- dsh: 不支持：同 cloud-web

## GuildChannelLister

`bothouse send --channel <名字>`：在当前对话所在的服务器里按名字找频道再发，找不到或重名就报错并列候选、不发（core/send_channel.go，用户 11-11「我说转给jiuwen，怎么转到这来了」）。

- discord: 已接
- feishu: 不支持：飞书没有服务器和频道列表，群之间没有「同一服务器按名字找」的关系
- cloud-web: 不支持：本机网页频道的房间由 collab 网关管，没有给角色列房间的接口
- dsh: 不支持：同 cloud-web

## TeamWorkspaceShelver

工作区平台可选实现它：把所有工作区放进平台自己的一个分类，空着的、在用的都放这里，不再按空闲/在用搬来搬去（docs/ARCHITECTURE.md:75）。Discord 新建工作区直接建在「工作区」分类里（没有就建），还在聊天频道旁边的老工作区由 core 在列池子、认领时挪进去，旧版「空闲工作区」分类里的在首次列频道时挪过去、空了就删；TeamChannel.Shelved 保留共享池的复用与编号语义；搬动失败只记日志，其他平台沿用原流程。

- discord: 已接
- feishu: 不支持：飞书的群组接口没有分类这个概念（platform/feishu/workspaces.go:76「Feishu has no categories: ParentID is empty」），工作区本身就是一个群，没有可挪的频道容器
- cloud-web: 不支持：网页频道的工作区是 gateway 的房间，整个共享池只有一个平铺的「分类」（platform/cloud-web/workspaces.go:98-99，ParentID 为空），没有可挪的频道容器

## TeamChannelGoneChecker

任务板收起「所在频道已删」的条目时用（core/team_task_board.go dropGoneTeamTaskBoard）：列频道只拿得到服务器的文字频道，子区、论坛帖、私聊当聊天频道派的活不在列表里；实现了它的平台，core 对不在列表里的频道单独问一次，确认删了才收起，拿不准就保留。没实现的平台沿用原规则（不在列表里就收起）。

- discord: 已接
- feishu: 不支持：飞书的列表就是 bot 所在的全部群（platform/feishu/workspaces.go:75-76），私聊、话题群本来就不能派工作区，列表里没有的群就是 bot 已不在，沿用原规则
- cloud-web: 不支持：列表是 gateway 的全部房间和工作区（platform/cloud-web/workspaces.go:97-99），房间不在列表里就是已删，沿用原规则

## DMMemberChecker

`bothouse send --dm --to <id>` 用它核对收件人在不在当前对话所在的服务器（#1352），核不了的平台 --to 只能写主人。Discord 用 GuildMember 逐个查。

- discord: 已接
- feishu: 不支持：飞书没接 DirectMessageOpener（platform/capability_baseline.txt 里的旧缺口），--dm 本身就开不了私聊，核成员没有用处
- cloud-web: 不支持：网页聊天没有私聊（同样没接 DirectMessageOpener），--dm 在这里直接报错

## DMRefusalDetector

`send --dm` 被平台拒收（对方不接收服务器成员私信）时，用它认出这种错误，改走私密子区（#1352）。Discord 认 50007。

- discord: 已接
- feishu: 不支持：飞书没接 DirectMessageOpener，--dm 开不了私聊，不会出现被拒收
- cloud-web: 不支持：网页聊天没有私聊，--dm 直接报错

## PrivateThreadOpener

私信被拒收时的兜底：在当前频道开一个只有本人（和管理员）能看的私密子区发过去（#1352）。

- discord: 已接
- feishu: 不支持：飞书没接 DirectMessageOpener，用不到这个兜底
- cloud-web: 不支持：网页聊天没有私聊，用不到这个兜底

## TaskForumPoster

任务帖子区（#768）：每个服务器一个论坛频道「任务」，任务板每条活一个帖子，首楼现状卡原地编辑、状态标签跟任务板变、关键节点发帖、完成归档（core/team_task_forum.go）。没实现的平台不开帖，其余流程照旧。

- discord: 已接
- feishu: 不支持：飞书群没有论坛频道和帖子标签，任务进度已由飞书任务卡展示；第一批只做 Discord（交接 #768「先只做 Discord」）
- cloud-web: 不支持：网页频道没有论坛频道和帖子标签；第一批只做 Discord（交接 #768「先只做 Discord」）
