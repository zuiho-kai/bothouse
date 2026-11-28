---
name: bothouse-team-workflow
description: |
  bothouse 组织智能体团队协作流程（飞书群 + 共享记忆论坛）：需求分析卡、话题干活与主群进度卡分离、卡住提醒、全队共享记忆检索与纠错归帖。
---

# bothouse 飞书团队协作流程

## 1. 收到「需求分析」时
1. 收集主群里各成员的关键原话（原样保留）和验收标准。
2. 调用 `bothouse_feishu_need_card`，自动从全队共享记忆论坛检索「以前定过的」规则，向主群发出需求分析卡。卡底提示「回复『开工』确认，或直接说要改哪里」；不依赖卡片按钮回调。

## 2. 确认开工后：聊天区与工作区分离
1. 有人在群里回复「开工」「确认」时，调用 `bothouse_feishu_topic_task(action="start", chat_id=..., subtasks=...)`（task_id 可省，会自动取该群最近一张待确认的需求卡）；有人直接说要改哪里时，改好后重发需求卡。
2. `start` 会在主群开一个任务话题，并挂出**唯一一张进度卡**。
3. 干活过程中的日志、测试输出、AI 同事讨论全部通过 `bothouse_feishu_topic_task(action="post_topic")` 发进话题，**不在主群刷屏**。
4. 每完成一步，调用 `bothouse_feishu_topic_task(action="update_progress")` 原地刷新主群进度卡。
5. 需要人拍板（缩范围、合入、花钱）时，调用 `bothouse_feishu_topic_task(action="ask_main_group")` 回主群问人。
6. 超过 10 分钟无进展时，`check_stuck` 先在话题提醒，仍不动再回主群叫派活人。

## 3. 全队共享记忆论坛与记忆流程
1. 所有 AI 同事共用同一份记忆论坛（非按角色隔离）。开工或遇到拿不准的规矩时，用 `bothouse_memory_forum(action="search")` 查 `[版块] 对象` 帖。
2. 用到某条规则时调用 `cite`；在群里/话题里被用户纠正时调用 `record_correction`（同类错第二次会自动升成硬性检查）。
3. 交回前调用 `bothouse_feishu_topic_task(action="complete", summary=..., evidence=...)`：若命中重复犯错检查会被直接退回。
