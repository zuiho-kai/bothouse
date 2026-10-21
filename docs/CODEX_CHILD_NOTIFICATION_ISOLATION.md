# Codex 子会话通知导致插话轮次提前结束

2026-10-21，针对运行版本 conest-20261021-card-lifecycle194（4f085a26313fd59dabc0ee259fa763874d1e59e8）的发布候选。

## 现场与根因

北京时间08:42:17桥接确认插话投递；父会话随后记录了新用户输入。08:45子Agent启动后，桥接在08:45:07提前记录turn complete，但父会话仍持续执行，之后输出转入unsolicited路径。原始JSON-RPC通知未保留；不能断言具体哪一条外部通知最先触发，但同样事件序列在生产源上稳定复现空结果。

同一app-server进程可发送多个thread的通知。生产源handleNotification没有先检查threadId，子会话的idle/completed会结束父轮次，started会覆盖父turn，消息和错误也会串入。主分支在#161的3e42e027已加入普通会话隔离，但本地发布基线未包含。本次只回移现有18行隔离逻辑，保留严格语音的fail-closed行为及所有现网功能。

另外现场08:48曾出现Discord TLS发送错误，已与此次提前收尾区分；归档讨论串状态栏更新400也独立存在。本候选不声称修复网络故障或线程归档行为。

## 复现与验证

- TestAppServerSession_ChildEventsPreserveParentReply：生产源五种子会话通知均失败，例如idle使currentTurn为空并产生Result；验证修复后仍有且只有父任务正文与Result。
- TestAppServerSendSteersWithChildLifecycle：真实适配器Send→JSON-RPC假app-server→turn/steer→子Agent生命周期→父回复。旧版0.46秒返回EventResult且text为空；修复后返回完整steered回复，未新开父轮次，未泄露子回复。
- TestAppServerSendStillSteersMidTurn、LocalInputAppServer系列通过；普通插话、严格语音错误边界保持。codex全包race通过。现网增量的46个Go测试包全过（含CUJ），codex全包race及vet通过；证据在.local/go-full.log、codex-race.log、codex-vet.log。

## 发布边界

此分支为现网4f085a26的最小增量，不应用主分支其他未部署功能。未发送真实模型/Discord测试消息，未改模型、配置、会话或进程。现场父会话仍有task_started而无task_complete，不能只凭桥接team busy=false判定可重启。等待真正结束，或由用户明确授权中断当前轮，再持共享部署锁备份和切换。源码测试不等于真人频道验收。
