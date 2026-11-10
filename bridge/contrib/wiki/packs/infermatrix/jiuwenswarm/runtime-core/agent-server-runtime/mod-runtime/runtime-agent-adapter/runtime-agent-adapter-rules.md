---
name: runtime-agent-adapter-rules
description: Agent adapter 运行时规则 JW-RUNTIME-ROUTING-1a、JW-DEEP-STOP-1a、JW-CODE-MEMORY-1a、JW-TEAM-GROUP-1a、JW-TEAM-GROUP-1b：Code 模型路由 rail、Deep 停止轮提醒、冷启动 memory 初始化、群聊载荷与 accepted
metadata:
  scope: 只收 agent_adapter 的运行时规则；逐文件接口记录归 runtime-agent-adapter-contracts-01 与 runtime-agent-adapter-contracts-02，本目录入口归 runtime-agent-adapter-overview
---
# Agent adapter 运行时规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-agent-adapter/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-06；updated: 2026-10-09
- 来源（sources）：PR #7689；PR #7796；PR #7587；PR #7794
- 置信度（confidence）：high
- [JW-RUNTIME-ROUTING-1a] Code 的模型路由 rail 由规范化 sub-mode 决定
  - 触发：修改 `CodeAdapter._build_agent_rails`、Code session 重建或模型档位路由的挂载。
  - 强制：以规范化后的 `sub_mode` 区分 profile；`normal`/`plan` 分支追加 `_model_routing_rail`，builder 为 `_build_model_routing`，参数使用同一 `config_base`；team 分支将该属性设为 `None`。重建时顶层 `mode="agent"` 的兼容默认不能替代 sub-mode 判定。
  - 验收：分别检查默认/规范化后的 `normal`、`plan` 与 team 分支，断言 builder、config 和属性清除一致；需要宣称档位转换有效时另核对 rail 的转换实现及实际路由测试。^[PR #7689]
- [JW-DEEP-STOP-1a] 停止轮次提醒只在 cancel 成功时计数，并在新轮消费一次
  - 触发：修改 xiaoyi_0.2.4.beta3 DeepAdapter 的 interrupt、普通 chat.send 或输出租约收回。
  - 强制：cancelled 且 intent=cancel 时递增停止轮计数，supplement 不计；普通新轮先有界收回 attach_output 租约，再消费并清零一次性提醒，只提示处理最新请求。
  - 验收：覆盖 cancel/supplement 分支、单次消费和 cancel 早于旧轮注册的租约竞态；超时按真实失败处理，不吞掉新请求。^[PR #7796]
- [JW-CODE-MEMORY-1a] 冷启动初始化去重且不阻塞请求，卸载时取消后台任务
  - 触发：修改 dev-stable interface_code.CodingMemoryRail 的 before_invoke、后台 manager 初始化或 uninit。
  - 强制：用一个保存的 task 启动冷初始化，不在 before_invoke 等待索引完成；并发调用共享该 task。cron/heartbeat 只读判定来自真实输入，只有 manager 可用且非只读时才预取；uninit 取消未完成初始化并清除 task 引用。
  - 验收：阻塞 initializer 时 before_invoke 仍及时返回且只创建一次任务；只读请求不预取，uninit 取消后台 task，取消不置完成标记；失败降级行为同时核对锁定的基类实现。^[PR #7587]
- [JW-TEAM-GROUP-1a] 群聊输入先构造并校验结构化载荷，再交给团队运行时
  - 触发：修改 `team_helpers.py` 的 `_group_chat_input`、首次团队请求准备或 `_deliverable`。
  - 强制：只有 `params.type=group_chat` 或 `params.query` 中明确的 group_chat dict 进入该分支；重新构造载荷。mentions 必须为 list，dict 项优先取 `leader_member_name`、其次 `member_name`，成员身份必须是非空白字符串并保序去重。body 必须是字符串；client_message_id 缺省或假值时回填 request_id，最终必须是非空白字符串；attachments 必须是 list 且元素为 dict。
  - 强制：首次请求准备保留群聊 dict，跳过文本指令提取；投递时不套 `UserTurn.render()` 或文本成员编址。输入校验的 ValueError 转为 `chat.error` 且 is_complete=True 结束流。
  - 验收：覆盖两种明确入口、普通请求、mention 身份映射与去重、identity 默认和保留，以及非法 body/identity/attachments/mention 的错误终态。^[PR #7794]
- [JW-TEAM-GROUP-1b] 群聊 accepted 是否结束请求取决于 mentions 与请求路径
  - 触发：修改群聊 round admission、`team.group_message.accepted` 或团队事件流终止。
  - 强制：无 mentions 的群聊跳过交互回合。成功且非首次请求的本地提交分支发带 client_message_id 的 accepted；无 mentions 时再 release_round，补 processing done 和空载荷 complete。事件循环中也只允许无 mentions 且 identity 匹配的 accepted 补 done 并结束流，identity 可来自顶层或 message。
  - 验收：覆盖首轮与活跃 follow-up、空/非空 mentions、匹配/不匹配的 identity，以及失败提交；断言终态和 round 释放符合对应路径。^[PR #7794]

## 决策与踩坑

- [JW-RUNTIME-ROUTING-1a] 禁止：只凭顶层 mode 决定挂载；给已由 relay 解析具体模型 ID 的 team profile 再挂同一档位 rail；把挂载 diff 或注释当作四档实际转换已验证的证据。
- [JW-DEEP-STOP-1a] 禁止：未取到输出流时静默只回 accepted；把 supplement 算作放弃；消费提醒前丢失收回过程中新增的取消计数；宣称注入提醒能保证模型必然服从。
- [JW-CODE-MEMORY-1a] 禁止：重复启动冷索引或阻塞用户首条请求；引入没有定义来源的只读属性；把 task 已创建当作 manager 初始化成功；将取消当作正常初始化完成。
- [JW-TEAM-GROUP-1a] 禁止：整包透传未经校验的原始 dict；仅凭 mentions 将普通请求识别为群聊；把 list/dict 类型检查宣称为已验证 JSON 可序列化。
- [JW-TEAM-GROUP-1b] 禁止：用其他消息的 accepted 结束流；带 mentions 时把 accepted 当作后续团队回合已经完成；把本地 accepted 的条件扩展到所有首轮或失败提交。
