# #751 主动跟进授权决策

状态：实现中。独立授权模块已实现；外部事件接入、所有执行边界和最终独立验收尚未完成，不能作为自动执行已上线的证据。

## 边界

`ProactiveAuthorization` 保存每个项目的策略、不可变决策、任务分配、撤权通知和受控动作结果。默认 `off`；`observe` 仅写本地记录；`auto` 下匹配显式配置的规则才得到可接单决策。没有评估模型调用或新增预算。明确真人请求仍走原权限路径，决策记录不能代替工具权限或操作系统沙箱。

身份是平台名与稳定账户 ID；同一主体的跨平台身份只能由管理员显式绑定。候选的认证、可见性和仅上下文标志来自入口校验，不接受 JSON 自证。机器人、转述和仅上下文输入不能升级为真人授权。决策记录不保存消息正文；完整来源标识只在管理员查询中返回。

策略替换必须携带当前版本，落盘成功后旧版本不能再接单或执行。任务引用决策 ID，分配记录另记角色、后端和会话。已受理源事件不会因为策略修订、重启或撤权而再次受理；不确定的在途动作不自动重做，取消后记录实际结果，不声称回滚。

## 接口

- `Engine.EvaluateProactiveCandidate(ProactiveCandidate) (AuthorizationDecision, error)`：仅记录，不派工、不确认、不外发。
- `Engine.AdmitProactiveTask(decision string, task *Task, backend string) error`：关联已有任务和可执行决策。
- `Engine.CheckTaskAuthorization(task *Task, scope string) error`：复核已有授权；无决策 ID 的旧显式任务保留原校验，因此不能把它当成外部事件的准入检查。
- `Engine.RunAuthorizedEffect(ctx, task, scope, operationID, callback)`：持久动作标识、执行前检查、撤权取消与结果记录。
- `Engine.SyncAuthorizationNotices()`：把授权日志中的撤回/版本变化投影为任务通知，可重放且不重复。

管理员 API 复用已有管理服务鉴权：`GET /api/v1/projects/{name}/authorization` 查询日志；同路径 `/policy` 支持 GET/PUT（PUT 携带当前 `version`）；`POST /revoke/{decisionID}` 撤回。策略授权者由已认证管理入口写入，不相信请求体中的授权者名称。

## 与并行实现的分工

#750 拥有外部事件来源绑定、受理和恢复投递；#749 拥有出站投递。#750 的 `ExternalTaskEvent` 仅追加已有任务，不创建任务或改变事实阶段。ContextOnly 输入不能通过授权关联升级为主动任务。公共 Engine 接线在 #750 合入后串行整合。

## 当前验证

单测覆盖模式、来源与身份、策略变更、并发接单、重启去重、写入失败、管理 API 鉴权、在途结果记录、撤权通知恢复与幂等。派工回归覆盖等待结束后仍在后台执行的任务：撤权必须关闭执行会话并留下失败回执，不能只结束等待。

尚需完成：真实事件入口与执行队列关联、受控权限/外发路径、明确停止与恢复、通知启动重放、全量沙箱测试及最终提交独立审阅。
