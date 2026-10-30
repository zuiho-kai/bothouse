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
