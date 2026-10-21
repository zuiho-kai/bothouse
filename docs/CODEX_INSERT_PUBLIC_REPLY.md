# 插话后的公开回复（Issue #208）

目标：长任务中插入消息后，伙伴生成的公开回复及时出现，原任务继续执行。收件回执“已插入”只代表输入已送达，不保证模型已生成回复。

## 已复现的两个原因

1. Codex app-server 已完成的 agentMessage 全部进入 pendingMsgs；即使 phase 明确为 commentary，也要等下一工具才按 Thinking 发出，或等 turn 结束按 Text 发出。C酱的公开 text 则直接进入 Text。以本机 CLI 的 generate-json-schema 生成协议核对，MessagePhase 区分 commentary/final_answer，并要求缺失 phase 保留兼容行为。
2. 核心在工具/思考边界 freeze+detach 旧预览，但下一段 Text 没恢复预览。仅修分类后，实际 Engine→gate→app-server→平台的回放仍失败：没有新的可见回复。旧 unfreeze 还会清掉传输失败状态，不能对每段文字无条件重置。

## 修改

- 明确标为 commentary 的普通 Codex 对话立即发出公开 Text。推理仍为 Thinking；缺失/未知 phase、final_answer 及严格本地语音保留原有缓冲边界。
- 预览记录正常冻结，只有冻结且已脱离旧消息句柄时可恢复。下一段公开文字创建新预览；活动消息不清空、发送失败不因此重试、已丢弃预览不恢复。quiet 模式继续遵守其合并展示方式。
- 工具后的最后一段优先原地完成新预览，避免把已显示回复再作为普通消息重发。

## 验证范围

回归覆盖：真实适配器 Send→turn/steer 后，在没有下一工具/任务结束时读取公开回复；真实 Engine.ReceiveMessage→gate→适配器→消息预览，确认新句柄及只启动一个任务；核心 CUJ 三次真人输入（启动、插话、结束），确认插话回执、新回复和不重复收尾；phase兼容、内部推理/严格语音边界、失败通道不恢复与活动预览不清空。

所有测试只替换外部模型进程、闸门HTTP和消息发送，不调用真实模型或Discord。部署及自然使用验收独立记录；本修复不能让正在执行不可中断工具或限流中的模型立刻生成文字。

本地验证：全部 CUJ、适配器/核心目标回归与 race、vet/构建通过。macOS 全量发现主线已有 TestSetupCLIsHint：即使测试清空 PATH，固定路径仍探测到已安装 CLI/App，断言空列表失败；使用 git HEAD 三个生产文件的 Go overlay 单测复现相同失败。未删改该测试。最终全量及 CI 结果见 PR。三条既有进度卡测试保留原卡片断言，并更新为校验后续公开答复的新预览与不重复发送。
