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
