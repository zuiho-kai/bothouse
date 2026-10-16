# Issue #28：失败回合的额度显示

## 事实与修复范围

2026-10-16 22:37、22:53，大豆包CLI返回ERROR和非空正文。生产桥接把正文拼进EventError并直接发送，跳过正常答案的模型/额度尾注；Discord只读核对与之相符。同一CLI的只读额度接口可正常返回Argon独立周池，采样约剩83%。这证明额度尾注缺失，不证明CLI本轮实际成功；后端ERROR的根因仍待另行诊断。

修复仅调整core失败消息的尾注投递：复用既有会话模型/真实额度查询与展示开关，保留失败分类、内容、队列行为和成功历史边界。长消息末段展示一次；富卡片已展示时不重复，更新失败时回退。没有修改模型池解析、权限策略、CLI参数、会话或私密配置。

源码从main的3090217c创建独立fix/28-error-quota分支，已包含PR #25的严格语音续接，不能用更早候选替换生产。另一个工作线在23:11部署了3090217c；本任务不能在Issue #27仍操作桥接时并行重启。

## 回归证据

`bridge/core/error_quota_test.go` 从真实Engine.ReceiveMessage入口驱动：失败含长正文→已排队任务成功→空响应失败→上游空ERROR。断言每种失败仍可见、末条只有一个正确模型的额度状态、无自动重试且只有成功答案进入历史。覆盖83%/0%/查询失败/无数据/关闭显示/缓存token状态行；另有富卡片成功投递与更新失败回退。原模型池/Argon隔离回归继续执行。

修复前运行 `go test -tags no_web ./core -run '^TestCUJ_ErrorQuota_' -count=1`，四类额度状态均明确失败，原因都是错误消息缺少尾注；显示开关场景原本通过。修复后新增回归通过。原日志保留在本工作区忽略目录 `.local/error-quota-red.log` 与 `error-quota-green.log`。

本机macOS检查全部通过（2026-10-16，no_web）：

- `go test -tags no_web ./... -count=1`，默认包并发全量；`.local/full-go-tests.log`。
- `go test -tags no_web ./agent/antigravity -run 'TestAgyPermissionBridge' -count=1`，原TCP审批；`.local/tcp-permissions.log`。
- `go test -tags no_web ./core -run TestCUJ -count=1`，完整CUJ；`.local/cuj.log`。
- `go test -race -tags no_web ./core ./agent/antigravity -run 'Test(CUJ_ErrorQuota|ErrorQuota|QuotaFooter|NativeQuota|AntigravityReportsQuota|AgyPermissionBridge|Stream)' -count=1`；`.local/race.log`。
- `go vet -tags no_web ./...` 与 `go build -tags no_web -o ../.local/cc-connect-candidate ./cmd/cc-connect`；`.local/vet.log`、`.local/build.log`，exit0且无诊断。

默认全量保留原先显式要求环境变量的真实账号测试跳过项；本轮没有把它们当作执行通过。真实接口采样来自前述生产CLI只读核对。此次由同一Agent自查，没有派生Agent或声称独立审核；Ubuntu检查以对应PR最终SHA为准。生产部署成功与真人Discord验收须独立记录，自动测试不发Discord消息。

## 部署记录

用户随后明确授权“合并部署”。PR #29于2026-10-16 23:28:58（Asia/Shanghai）合并：最终审核提交ae71cdd8541faac0e4b27e4cb68d73546328c694，合并提交a884de2dbc001975e7348b7963eb4d22b0f4b7a6。源码树完全相等；最终Ubuntu run38923207087的bridge（依赖校验、构建、Go全量）和companion（Python测试）均成功，同一Agent自查结论已留在PR。

发布前动态核对生产仍为3090217c、PID18026、二进制SHA256 c57b7555a9444b8ce9cc69032128f924fb2db291a80b85caad03d05f39272e08。相对该版本，本次仅新增错误尾注投递、回归与文档，保留已有语音严格续接、模型切换、记忆和调度。初次检查G哥仍忙，未中断任务；待六份新鲜心跳无busy且8787/8793无活动轮次或讨论后才切换。

- 构建参数：在bridge内执行 go build -tags no_web -ldflags '-s -w -X main.version=conest-20261016 -X main.commit=a884de2dbc001975e7348b7963eb4d22b0f4b7a6' -o ../.local/cc-connect-release ./cmd/cc-connect。
- 发布路径：/Users/zhaixinyang/cc-connect/cc-connect，SHA256 deb7fae10bfad53e63205ca8e356dcb8353a56b724fa31565dd3ceee71762206，权限0755；旧源码工作树未覆盖。
- 备份：~/.cc-connect-maomao/backups/error-quota-20261016-233528/。目录0700，旧二进制、最新config.toml、六份会话、cron/timer快照保留原文件权限，deployment.json为0600。原配置与G哥刚应用的yolo模式保留；不复制凭据或完整会话进Git。
- 切换：旧PID18026经SIGTERM正常退出，新PID22719于23:35:37启动；复用原参数、进程环境、cwd、/dev/null输入，stdout/stderr追加run.log。PID仅为当时快照。
- 复核：六个不同Discord连接、六Engine、本地/sessions、/cron/list、/timer/list正常；配置字节及0600权限、六份active_session/agent_session_id映射和调度定义保持；旧日志前缀哈希一致，启动后无ERROR/panic；8787/8793仍可访问且空闲。未发送Discord消息，没有重启通知标记，未改权限/配置/会话，未派生Agent。

**部署成功，真人验收尚未完成。** 用户在“常规”点名大豆包，要求只执行一次 git -C /Users/zhaixinyang/conest branch --show-current 并返回实际输出，不改文件、不派生。若出现审批，选“本次允许”，按本轮时间核对permission request/resolved及工具结果；未出现审批则如实记录，不更改策略强行制造审批。核对回答、错误状态和正确模型/额度尾注。CLI仍可能返回ERROR，本修复不将其改为成功；Issue #28保持开放。

回滚仅恢复上述备份二进制：先重查唯一PID与忙闲，正常停止、保权限原子替换、按原方式追加日志启动；保留最新配置、会话、共享记忆与调度。本次未触发回滚。部署脚本和检查日志在独立工作区.local/，敏感快照仅在私密备份；有旧二进制哈希保护的脚本不能作为通用重启命令盲目重跑。
