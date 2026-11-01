# #751 主动跟进授权决策

状态：实现中。独立授权模块已实现；外部上下文事件与任务文字投递边界已接入；主动消息受理、完整队列/外发边界和最终独立验收尚未完成，不能作为自动执行已上线的证据。

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
未配置管理令牌时，这组接口拒绝访问；管理服务的兼容无令牌模式不能证明管理员身份。

## 与并行实现的分工

#750 拥有外部事件来源绑定、受理和恢复投递；#749 拥有出站投递。#750 的 `ExternalTaskEvent` 仅追加已有任务，不创建任务或改变事实阶段。ContextOnly 输入不能通过授权关联升级为主动任务。已在 #750 合入后串行整合 develop（91aed5d3）：外部事件始终以 ContextOnly 记观察，再重验已有任务的 task.resume；任务文字每段发送前校验 message.send。

## 当前验证

单测覆盖模式、来源与身份、策略变更、并发接单、重启去重、写入失败、管理 API 鉴权、在途结果记录、撤权通知恢复与幂等。派工回归覆盖等待结束后仍在后台执行的任务：撤权必须关闭执行会话并留下失败回执，不能只结束等待。

任务日志启动和投递重试时重放撤权通知，已经投递过的卡片重新排入投递。继续已有任务先重验授权；明确取消把撤权写入授权日志，重启后不能重新接单。`proactive_permission.go` 保留派工来源任务引用，在每次许可前读取最新任务与策略，且不把普通拒绝提升为允许；现已接入派工前台/后台 drain 和交互式许可分支，包括委托审批；只收工具执行后通知的后端不构成受控执行边界。

2026-11-01 验证记录：

- 授权、管理 API、PublicProgress、TaskRelay、TaskMember 相关竞态测试通过，`go vet -tags no_web ./core` 通过。
- 后台派工撤权回归在旧 `relay_task.go` 上失败（`revocation left background executor running`），恢复修改后通过。
- 全量测试最初在 hook 安装夹具超时。单跑 `TestAgentHooksQoderIFlow` 也在 90 秒超时，堆栈位于 `AtomicWriteFile` 的同步写入。`useRepoHooks` 把整个 bridge 当作文件源；换为正式内嵌 `AgentHookFiles` 后同一测试 2.928 秒通过，不改变生产安装器。
- `TestSetupCLIsHint` 在本机发现固定路径安装的 CLI，未符合测试的空列表预期；在原始基线 `1aa3bd81` 也复现。全量重跑已结束：core 365.530 秒通过，唯一失败包为 cmd/cc-connect 的该既有用例。该全量结果对应接线前快照，最终提交仍需重跑。

尚需完成：真实事件入口与执行队列关联、受控权限/外发路径、全量沙箱测试及最终提交独立审阅。

## 2026-11-01 接线检查点

- eb4bc93d：合入749/750接口；外部事件撤权、任务文字分段间撤权、后台工具审批实际路径回归通过。
- 管理入口新增 POST /authorization/renew/{taskID}：只重新评估原任务的身份和原范围，创建新决策并记录前后关系；旧决策仍拒绝，明确撤权/取消不恢复。失败的跨日志投影可重试，不重复接单。
- wiki/gate/context/context_subscription/context-only 在策略和评估两层均不能成为授权来源。
- 队列、容量重试、重启日志携带不透明任务/决策引用；恢复在旧进程清理后和每次投递前重验，不同决策不合并为一次恢复。混合队列的持久恢复关联、主动受理、完整外发及取消仍需继续接线。
- 新增定向 race 回归通过；最新全量/CUJ及最终独立审阅尚未完成。
