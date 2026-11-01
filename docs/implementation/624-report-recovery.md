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

平台成功只代表接受发送，不证明用户已读或已验收。平台接受后、送达状态落盘前崩溃仍可能重复投递；普通 Platform.Send 无幂等回执，不声称跨崩溃 exactly-once。多分片原文部分成功后失败，重试也可能重发已成功片段。

持久化失败记录错误，不能保证重启恢复。回滚本 PR 撤销此恢复链路，旧记录保留。未部署、未重启、未改生产配置、未做真实频道端到端验证。
