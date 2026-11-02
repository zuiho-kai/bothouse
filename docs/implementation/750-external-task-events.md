# 外部事件归入已有任务（#750）

现有 cron/poll、鉴权 webhook 可提交 task_events 数组。事件显式关联已有任务，先持久受理再提交连续游标，由现有进度循环投递到当前执行者的已有会话。没有新总线、调度器、数据库或隐式任务创建。旧非结构化 poll/webhook 保留原行为。

#511 已关闭，尚无持久 TaskInput 可复用；按 #750 允许的显式 task ID 路线复用 PublicProgress 任务、归属和工作区记录。输入只提供上下文，不扩大权限。intake 不改变任务事实阶段，PR 合并和 CI 通过不等于部署或验收。

## 本地控制

替换 PROJECT、DATA、TASK 和平台原始稳定标识；source_instance 区分账号/安装实例，thread_ref 使用原始线程或资源 ID，不用昵称。

~~~sh
bothouse task event-source --project PROJECT --data-dir DATA --id TASK --source github:installation-17 --thread github:repo:42:issue:9 --enabled
bothouse task events --project PROJECT --data-dir DATA --id TASK --source github:installation-17
bothouse task event-source --project PROJECT --data-dir DATA --id TASK --source github:installation-17 --thread github:repo:42:issue:9 --enabled=false
bothouse task event-ack --project PROJECT --data-dir DATA --source SOURCE --event-id EVENT --assignment ASSIGNMENT
~~~

这些命令连接已有 Unix API。只有可信本地操作者可注册/停用，公开 webhook 不能创建绑定。来源线程不能改绑别的任务；新授权关系使用新的来源实例。停用保留历史，阻止受理、投递和 ACK。源平台撤权由可信适配层停用绑定或 SetExternalTaskEventCheck 拒绝；core 不冒充能查询平台权限。ACK 命令由投递上下文给出，仅记录读过输入，不是执行成功，旧代次返回冲突。

## 事件与游标

~~~json
{"task_events":[{"source_instance":"github:installation-17","event_id":"delivery-123","task_id":"TASK","thread_ref":"github:repo:42:issue:9","actor_kind":"human","actor_id":"7","occurred_at":"2026-11-01T00:00:00Z","payload_ref":"fixture:comment/123","source_sequence":1}]}
~~~

actor_kind 支持 human/bot/ci/system，均按上下文处理。重放时发生时间、payload_ref 必须稳定，不能改成每次读取时间。core 不抓取或执行引用；冻结内容应由适配器提供不可变快照。空数组表示无事件；null/损坏信封报错，不回落旧唤醒路径。

source_sequence 可省略；提供时是每来源实例从 1 开始的连续输入序号，不能直接用有空洞的全站 ID。无序来源依赖 event_id 去重，不推进数字游标。脚本从 task events 的 cursor 补读，只能据已持久前缀保存上游游标，不能据已打印 stdout 推进。不透明上游游标由适配器维护与输入序号的映射。

同源同 ID 相同内容返回原记录；内容不同或重复源序号冲突。中间写失败仍保留后续成功项，cursor 停在空洞前。HTTP 批次失败返回 409，同时带成功记录和 cursor，可重放整批。无权线程和不存在任务拒绝。

私有日志位于数据目录 task-inputs，复用 AtomicWriteFile。保留 source_sequence、occurred_at 与独立本地 order；intake 不把迟到状态写回任务事实，执行者收到乱序提示并可查询历史。此日志是受理权威，不是公开摘要流或 wiki。

## 投递、恢复、权限

状态为 accepted → routed → delivering → delivered → consumed；待路由 pending_route，终止任务 rejected。代次包含任务、修订、角色、已有会话、工作区 claim/归属。换模型不创建新任务。受理、路由、Send 前和 ACK 均复查；#751 可串行接入 SetExternalTaskEventCheck。

暂停、限流、繁忙、解绑、撤权不会新建会话或抢工作区。结束一轮的 result_ready 任务仍可接收新事实；等待用户、失败、完成、取消的任务不唤醒。重启把未结束任务标为失败；新回合明确续办失败卡后才恢复积压输入。取消和已验收不能这样恢复。外部事件执行中 /stop 会取消原任务，后续输入不会再次唤醒它。本次补齐 resumeHint 已提供失败卡但 Report 不允许新回合续办的矛盾。

Send 前持久记录 delivering；此后崩溃或发送结果不确定，不自动重发，因为工具可能已执行。delivered/consumed 也不重放；尚未尝试的输入恢复合法归属后重试。不声称跨进程“恰好执行一次”，不确定投递需操作者检查。

## 脱敏适配样例

~~~sh
python3 bridge/contrib/task-events/github_event.py github:installation-17 TASK delivery-123 2026-11-01T00:00:00Z bridge/contrib/task-events/github-comment.json
python3 bridge/contrib/task-events/github_event.py github:installation-17 TASK delivery-124 2026-11-01T00:00:00Z bridge/contrib/task-events/github-check.json
python3 bridge/contrib/task-events/github_event.py github:installation-17 TASK delivery-125 2026-11-01T00:00:00Z bridge/contrib/task-events/github-pr.json
python3 bridge/contrib/task-events/wait_condition.py venue:provider-7 TASK bridge/contrib/task-events/wait-satisfied.json
~~~

GitHub 样例只转换已验证事件，不是公网接收器：可信网关先验证签名，再传原始 delivery ID 和稳定时间，最后带已有 webhook token POST。评论/PR 使用 issue thread，CI 使用 commit thread，均可指向同一任务。非代码样例读取可信条件快照；未满足空输出、读取失败非零退出、满足才输出事件，不占 gate 阻塞等待。轮询沿用 cron poll Exec。

| 入口 | 本次能力 | 限制 |
| --- | --- | --- |
| Discord | 原任务归属、已有会话投递 | 不创建或抢工作区 |
| 飞书、QQ | 可信适配器按原始来源和线程 ID 追加同一任务 | 不新增原生订阅或聊天自动关联 |
| DSH、cloud-web | 本地 task events 查询同一任务来源和回执 | 不新增网页面板或原生连接器 |
| 无卡片平台 | 私有任务与事件日志照常记账 | 投递需 ReplyContextReconstructor；跨角色沿用 reporter 绑定能力 |
| poll/webhook | 共用持久身份、冲突与游标 | webhook 必须配置认证，不信任 payload 自报权限 |

以上是 fixture 验证的适配契约，真实平台核对与部署另行记录。

## 验证

TestExternalEvents 覆盖持久故障、空洞、重放、冲突、真实 Engine.Send 单次投递、旧 ACK、暂停/停用/撤权、重启后续办、跨入口绑定查询、非代码等待。同组 race 检查通过。完整 Go 测试、二进制入口和独立审核证据见 PR；未部署或重启生产。
