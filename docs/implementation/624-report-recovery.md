# 624 工作区报告持久恢复

## 问题与边界

唤醒主角色成功只表示排队，不表示平台接受了报告。原 PR625 基于旧生命周期；整合保留 PR800 的待验收和 PR807 的独立任务文本队列边界。所有 CLI 共用 core 出口，handback 不进入 task-bound Send 队列，不重跑 agent 补报告。

## 实现

- team_report_delivery.go 在 dataDir/team-reports/<project>.json 原子保存待发正文、关联 timer、错误、次数和去重时间。
- team_auto_return.go 仅为工作区报告携带 pendingReport，普通主频道转话仍使用通用唤醒入口。先持久化再排队；排队失败直接补送，被拒绝则保留记录。
- team_exit.go 在摘要发送前保存记录，成功才标去重；失败尝试原文兜底，两次失败留给恢复扫描。保留最新四段排版、细节策略与重复报告抑制。
- engine.go / timer.go 在可见最终答复、静默、失败及提前退出时结算记录；启动和现有看门周期恢复无活跃唤醒的报告。
- 成功出口保存 exitReported 回执并调用 endWorkspaceTask：报告登记 returned，由派活人验收，绝不以送达调用 done。ask 沿用等待用户和释放工作区逻辑。
- 恢复依据记录绑定的看板项判断用户取消，不依据工作区后来接的新任务。

## 验证

基线 develop 88b3f7f4，原 PR head 13f6faf6。

TestReportDeliveryLeavesPendingVerification 在仅解决冲突后先红：summary/enqueue-failure 未写 ReturnedAt，fallback/restart 缺 exitReported 回执；统一出口后通过，覆盖五条路径。

TestCUJ_ReportWakeDeliveryReceipt 从 ReceiveMessage 经 fake agent 的 EventResult 到实际发送出口，覆盖可见摘要、NO_REPLY、最终发送拒绝，每条检查结果送达一次、恢复不重发。TestReportRecoveryDoesNotReviveStoppedTask 检查用户取消。原持久恢复、入队失败、持久化先于排队、活跃唤醒不抢发及重复交回测试保留。

定向测试 2.209s、CUJ/Timer/Report 联合 26.624s、定向 race 3.524s、vet 通过。最终补测、全量与独立审核以 PR 最新记录为准。

## 限制与回滚

独立审核发现：ask 摘要已送达时，同 key 的报告回执会拦住后续主角色唤醒。已送达的提问现在走现有普通主角色队列，不再创建待送达报告；摘要仍由原回执去重。TestReportPostedAskStillQueuesLead 在修正前复现零入队，修正后要求入队一次、目标频道和看板正确，恢复扫描及重复提问不重复发送或唤醒。

平台成功只代表接受发送，不证明用户已读或已验收。平台接受后、送达状态落盘前崩溃仍可能重复投递；普通 Platform.Send 无幂等回执，不声称跨崩溃 exactly-once。多分片原文部分成功后失败，重试也可能重发已成功片段。

持久化失败记录错误，不能保证重启恢复。回滚本 PR 撤销此恢复链路，旧记录保留。未部署、未重启、未改生产配置、未做真实频道端到端验证。

## 2026-11-02 develop 冲突整合

基线从 88b3f7f4 更新至 develop 34ea70a374fad3affd3069027676e17af1fe52a1；此前返工头为 26205723bcc50ffce495958f7af9b49aa24737dc。engine.go 同时保留报告 timer 身份、提前退出结算及授权观察/逐次发送校验；team_auto_return.go 保留授权绑定回传不得创建无授权 timer 的规则，并传递 posted/headline；team_exit.go 的摘要、即时兜底和分片发送沿用授权 context。

仅消解文本冲突会使恢复扫描使用普通 engine context，导致被撤销的报告重新发出。TestReportRecoveryPreservesSourceAuthorization 在该合并状态先红：restart delivered 1 reports, want 0 (revoked=true)。待发记录现在保存 AuthorizationTurn 的来源项目、任务及决定引用，恢复时用现有 turnOutputContext 重新解析；每片发送仍由 sendRenderedWithContext 检查当前授权。新引擎读回记录后，有效授权恰好补送一次，撤销授权不补送；定向回归 0.605s 通过。该修改只衔接双方现有语义，无新增设置或参数。

验收范围缺口仍在：posted ask 已送达后走普通主角色 TimerStore；若 AddJob 写盘失败或主角色不可用，缺少持久唤醒重试，因此可能永久漏唤醒。不能因为改前也失败就豁免原要求，也不能称失败重试全场景通过。此轮未改该逻辑，交主区连同冲突增量安排非作者复审并决定后续修复；在缺口解决或明确调整验收前，不宣称总任务完成。

本轮复用旧全量证据，另跑冲突相关 Report/Headline/CUJ/ChatLead/Proactive/Capacity/Timer race 回归和 vet；最终结果见 PR 和交接。未自验收、未合并、未部署、未重启，未发送真实平台验收消息。

收尾远端核对：克隆的 fetch refspec 仅跟踪 main，origin/develop 不随显式 fetch develop 更新；以 FETCH_HEAD 与 ls-remote 核对后，继续整合真实 develop 788c67a8d602159108387b4f69f9045106c53d32（新增看门续接和任务板活动判定）。该次自动合并无冲突，team_watch.go 保留既有报告恢复扫描及新增看门续接语义；增加 Watch 定向回归。34ea70a3 保留为前述失败对照的精确基线，不混称最新 develop。

最终基线整合验证：Report/Headline/CUJ_Report/ChatLead/Proactive/Capacity race 7.013s 通过，vet通过。加入 Watch 的组合12.703s失败于 TestWatchStartedFires（会话清理与事件读取竞态），在精确788c67a8基线单测0.742s复现；如实保留，未以基线失败豁免总体验收。前一基线上的TimerStore竞态及临时目录清理失败也保留在交审材料。
