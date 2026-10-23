# Issue #13 空响应修复复核

最新状态：下文按时间保留早期受限记录。2026-10-16 21:26发布版本已由另一工作线部署，本线独立复核通过；当前事实以本文末节为准，真人Discord验收仍未完成。

2026-10-16，Asia/Shanghai。本轮验证的是已提交快照
`6f7c40158b5c964b53328218e82ccc59b1c70643`（包含空响应修复
`b7a3d114`），不是原工作区后续未提交的真实额度接口改动。

## 结论与范围

审批决定转换、空结果识别、纯空白流片段处理已通过旧实现失败／修复实现通过的对照。
定向竞态检查、空响应后的排队与历史记录检查、相关静态检查及候选二进制构建通过。
完整 TCP 审批集成及完整 CUJ 尚未通过本环境验证：沙箱拒绝监听本地端口。
没有部署、重启、调用真实模型或发送 Discord 测试消息，不能据此宣称线上恢复。

当前源码仍只能明确提示不支持的额度查询；真实账户余额接口的未提交工作未纳入此快照。

## 直接证据

- 20:04:14 本机 Antigravity 日志记录 print 模式对 RunCommand 工具确认执行 soft-deny。
- 旧审批处理函数返回 allow；已有修复在桥接获得批准后返回 auto_approve，保留拒绝和私密 token 校验。
- 旧 stream result 处理在 SUCCESS 无正文时产生成功事件；已有修复产生 ErrEmptyAgentResponse。
- 本轮新增 permission_contract_test.go，使用内存连接进入真实 handleConnection 和 RespondPermission，覆盖批准、拒绝、鉴权失败。没有修改或跳过原 TCP 集成测试。

## 可复现验证

在 bridge/ 运行；本环境 GOCACHE 指向可写临时目录，GOPROXY=off 使用已有依赖缓存。

~~~sh
go test -race -tags no_web ./agent/antigravity ./agent/antigravityhook -run 'Test(AgyPermissionBridge_DecisionContract|AgyPermissionBridgeRejectsInvalidBehavior|StreamSession_(EmptySuccessIsError|WhitespaceDoesNotHideResult)|Relay)' -count=1 -timeout=60s
go test -race -tags no_web ./core -run 'TestCUJ_Response1_EmptyAnswerKeepsQueueAndHistory|Test.*Quota|Test.*ReplyFooter|Test.*ClaudeStatus' -count=1 -timeout=90s
go vet -tags no_web ./agent/antigravity ./agent/antigravityhook ./core
go build -tags no_web -o ../.local/cc-connect ./cmd/cc-connect
~~~

以上命令全部退出 0。核心 CUJ 验证：失败不写成成功历史，不自动重发工具任务，已排队请求和下一条消息正常完成。

红绿对照在独立副本中只把 permission_bridge.go 和 stream_session.go 换为 b280972f 的旧版本，保留当前测试及错误类型，随后按原始字节恢复。旧路径退出 1，明确命中：

- decision = allow，期望 auto_approve；
- empty success reported as a completed answer；
- final answer lost after whitespace。

恢复修复后同一命令退出 0；拒绝和错误 token 在前后两版均被拒绝。
独立工作副本的 .local/verify_empty_response.py 保存对照步骤；
.local/empty-response-before.log 与 .local/empty-response-after.log 保存输出。这些本机验证文件未提交。

## 未通过的环境检查

完整 stream/TCP 测试在 newAgyPermissionBridge 的 listen tcp 127.0.0.1:0 处被拒绝。
完整 CUJ 命令在 TestCUJ_A9_GateFastBurstPreservesFollowUps 的 httptest 监听处终止：

~~~text
bind: operation not permitted
~~~

这不是测试通过，也不能据此认定代码失败。必须在允许本地监听的环境重新执行原 TCP 测试、完整 CUJ 和全量 Go 测试后，才能继续发布验收。不能改成跳过测试或放宽断言。

## 产物与接手

独立副本位于 /path/to/agents-demo/.work/conest-13-verify.mvrpoK/repo，分支 verify/13-empty-response。
原 /private/tmp/conest-response-fix.Lhvq1N 的未提交代码保持原样。

候选程序：.local/cc-connect，SHA256：

~~~text
be1cc77143bdfcf497d25a9077136692e16ffcd87781d20a67cab507caf0677a
~~~

候选程序尚未发布，不包含后续额度接口改动。接手时先核对源分支最新提交，再决定采用哪个版本；不能直接覆盖正在运行的二进制。当前生产目录不在本会话可写范围。

## 后续发布复核（2026-10-16，Asia/Shanghai）

本轮在可监听本地端口的独立部署worktree继续；下列结果替代上面的“TCP/CUJ受限”结论，保留旧失败记录。原工作区后续额度接口另在PR #18推进，未混入部署候选。

生产核对：旧源码重新以Go1.25.14、darwin/arm64、no_web构建，SHA256为7ac1caad1939f5a6b4b9df120e73dba24037cfad50e57f2b162da9247584cc1f，与正在运行的二进制逐字节一致；502个桥接Go/模块/模型技能文件与导入提交e9f902d4一致。候选保留这些功能，并包含已合并的PR #14生命周期修复。

通过的命令（bridge目录）：

~~~sh
go test -tags no_web ./agent/antigravity ./agent/antigravityhook -run 'Test(AgyPermission|StreamSession|Relay)' -count=1 -timeout=120s
go test -tags no_web ./core -run TestCUJ -count=1 -timeout=180s
go test -tags no_web -count=1 -timeout=180s ./...
go vet -tags no_web ./...
go build -tags no_web ./...
~~~

原TCP允许/拒绝/错误token、完整CUJ均通过，无跳过或修改原TCP用例。相关race覆盖审批、空响应恢复、额度状态、模型切换、共享记忆和路由状态栏。新增公网隔离测试的race结果与最终构建产物在发布记录中补充。日志位于部署worktree的.local/，不提交运行日志或凭据。

本轮全量失败及处理：

- 飞书路由测试用真实SDK执行用户/群名及引用消息查询，45秒诊断超时堆栈停在公网DNS/HTTP；首轮全量飞书包555.8秒后失败。改用可控SDK HTTP响应，仍走真实解析和分发；保留原路由断言，并断言模拟名称确实到达handler。
- 状态栏矩阵仍期望旧的“模型→目录”格式，遗漏本修复增加的额度可用性提示；更新精确预期，并在关闭状态栏时断言额度提示也不出现。
- 用户报告QQ/MAX触发LuLu：QQ交互测试漏配token/ACK接口，MAX去重用例调用Start时访问http://unused。先添加测试HTTP边界得到失败证据（external-http-before.log），再补本地服务器；修复后三个包通过（external-http-after.log）。HTTP边界在DNS/连接前拒绝非loopback请求，并使整个测试包失败，即使业务代码吞掉该请求错误。生产网络策略未改。
- 一次并行运行全量与race构建时，Codex关闭测试在等待假CLI的thread.started阶段超过原有5秒；尚未调用Close。没有修改Codex代码或延长等待；单项重复10次、整包重复3次及之后两轮默认并发全量通过。并行编译负载是线索，未证明唯一根因；保留full-go-tests-fixed.log和codex-close-repro.log、codex-package-repeat.log，不宣称已修复这个偶发启动问题。
- 最新全量日志full-go-tests-network-isolated.log退出0；原full-go-tests.log和诊断日志保留。一次为停止外网测试而核对进程时，该轮已自行结束，未杀生产进程。

部署仍须以最新源提交的CI、最终二进制构建和临停忙闲检查为门禁。部署成功与真人审批/工具回答验收分开记录，不发送自动Discord测试消息，不清会话，不更改权限模式。

## 最新主分支与已部署版本复核

在本线验证期间，PR #18合入main为7027a4a15b1212379604819860eadb5bfc7c8028，并已部署。原目录从后续额度提交变成干净发布提交，本线没有覆盖它。同步该main时保留全部业务代码（含真实额度、模型/Agent缓存隔离与周额度），只补本线测试与记录；不再发布此前不含真实额度接口的候选。

独立用相同构建参数从干净发布源码重建，SHA256与实际生产完全一致，见部署记录。最新源码重新检查全部exit0：

- full-go-tests-current-main.log：go test -tags no_web -count=1 -timeout=180s ./...，默认包并发，包含新增额度包。
- tcp-current-main.log：原TCP审批/StreamSession/Relay集成，不用内存合同测试替代TCP。
- cuj-current-main.log：完整TestCUJ。
- race-current-main.log：审批、空响应恢复、额度、模型切换、共享记忆、相关适配器与额度接口。
- race-network-current-main.log：QQ、MAX、飞书、测试HTTP边界全包race。
- vet-current-main.log、build-current-main.log：全包vet与no_web构建。

前一次Codex启动等待超时仍无唯一根因，不能以本轮全绿覆盖旧记录；已拆出[Issue #23](https://github.com/Zssan12/conest/issues/23)跟踪。Ubuntu最终检查以PR #20当前完整SHA的GitHub Actions结果为准；本机记录不替代Linux检查。
