# 交回验收（#797）

最终工作区报告已送达聊天频道后，bridge 调用 board returned，保存 returned_at、reviewer，并释放工作区。任务留在 board.jsonl；只释放或暂停工作区不会产生交回记录。新派活保存 dispatcher；已有条目回退到交接 Sender，再到处理交回的主角色。

派活人先验实际产物，再用 board done <编号> <返工次数> 收口；有问题用 board reject <编号> <问题> 记录，再 ws-handoff --resume <编号> <问题>。后者复用原有空闲工作区选择与排队，不抢占其他任务。退回反馈不会被自动清理；重绑定后结束该保护。

原有工作区 watcher 调度初次通知、一次超时提醒、每小时收口检查。通知采用既有 TimerStore，ID 绑定任务、交回时间和提醒阶段；重启重建不重复添加。验收完成或退回后，定时任务执行前根据交回时间取消过期提醒。派活人未加载时保留待验收，恢复后重试。

项目配置 team_review_after_seconds 调整超时门槛；默认沿用 teamTaskBoardStuckAfter 的一小时。不新增生产配置，不部署。旧条目不能仅凭工作区已释放推断交回；没有持久交回证据的显示暂停，需要负责人按实际产物处理。

相关实现：bridge/core/team_task_review.go、team_workspace_one.go、team_task_board.go、timer.go；bridge/contrib/gate/board.py。新增用法由实际 CLI 隔离测试覆盖；Go 回归覆盖原派活人路由、重启去重、超时和工作区释放。
