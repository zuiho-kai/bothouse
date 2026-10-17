# 排队消息与后台事件读取交接（#49）

## 问题与修复

PR #48 的 bridge CI 在双平台并发 CUJ 中等待30秒后仅记录5/2条用户消息。本机在 main `92731ea1756a708243ad47c70643ca18631b469b` 复现2/5条的同类故障；它独立于 #48 的 Python 配置改动。

前台轮次结束后，旧代码先启动后台 unsolicited reader，再处理在交接窗口到达的排队消息。两个消费者并发读取同一个 AgentSession.Events；失败日志显示排队轮次的结果被记成 unsolicited turn complete，前台等待不到回执，剩余队列不再推进。

现在由 drainPendingMessages 统一交接：发送排队请求前停止并等待后台读取退出；队列清空后，在释放 session 锁前恢复空闲 reader 与 idle-close timer，再在 state.mu 下复查队列。此时若又收到消息，就撤销空闲状态并继续排队处理。删掉调用方在清理前或解锁后的重复启动，保留新前台可以取消旧 timer 的时序。

## 验证（2026-10-17，macOS / Go 1.25.14）

- 旧实现原场景：`GOMAXPROCS=2 go test -race -tags no_web ./core -run '^TestCUJ_H2_TwoPlatformsConcurrentNoBleed$' -count=500 -failfast -timeout=180s`，约51秒内失败，userA=2、userB=5。
- 确定性回归 `TestDrainPendingMessages_StopsIdleReaderBeforeSending`：在真实 Send 边界检查旧 reader 已退出；旧代码立即失败，修复后通过，并验证三条排队消息均形成历史和平台回复。
- 新增 `TestDrainPendingMessages_RechecksQueueBeforeIdleUnlock`：在空队列检查与释放锁之间注入消息，验证继续处理、先停止旧 reader、恢复 timer，不依赖 sleep。
- 原 H2 场景与首个回归一起带 race 重复500轮通过，99.647秒。
- 两项交接回归带 race 重复20轮通过。
- 完整 CUJ、UnsolicitedReader、AgentSessionIdleTimeout 及交接相关测试带 race 通过。
- `go test -tags no_web -p 1 -count=1 ./...` 全量通过；第二项交接回归随后单独带 race 验证。

本次使用假平台/假 Agent，不消耗模型额度、不向真实频道发送测试输入。构建、CI、审核和合并状态以 PR 的最终提交为准。没有部署或重启生产服务；#47/#48 仍需各自修复和验收。
