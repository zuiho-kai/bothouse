# QQ 慢上游：隔离故障注入与连接收尾

本次基线为 develop `3dc707ef122d9ac1580713e75ff6dfbebc00cb72`。Refs #819，
不把历史截图的积压和两个空泡认定为同一个原因。此前 #820、#844、#863、#1360
已经修复空白保护、工具后不重放、群队列合批、共享写阻塞；现有六类测试在本次基线上通过。

## 本次仍可复现的问题

1. OneBot 收到两条消息但未回 echo，随后断开：两个 `Send` 都继续等 15 秒回执期限。
2. `Platform.Stop` 关闭连接后，已有回执仍然等待同一超时。
3. 读循环已进入重连时调用 `Stop`：两秒后仍会连上新 socket，平台停止后留下连接。

三个问题都有先红后绿证据，测试名分别为
`TestDisconnectedReceiptsReleaseWithoutReplay`、`TestStopReleasesPendingReceipt`、
`TestStopDuringReconnectDoesNotOpenNewSocket`。最终版用例 overlay 基线的 `qq.go`，失败信息为：

```text
disconnected receipt still occupies a sender until the 15s timeout
Stop left an in-flight receipt waiting for the 15s timeout
stopped platform reopened a socket: connections=2, want 1
```

修复为每条 socket 记录独立的关闭信号。读失败、写失败和 Stop 关闭该代连接并唤醒它的
回执等待；已经读到的 echo 仍有效，没有 echo 则报告 `delivery unknown`，不标成
`ErrTaskTextNotAccepted`，不触发重放。新连接获得新信号。既有重连次数/间隔不变，
等待、握手和安装新连接都服从平台取消。生产改动仅在 `bridge/platform/qq/qq.go`；
已核对 #1696 的四个文件，没有改动 core 队列或与其重叠的文件。

## 可重跑入口

需要 Go、Python 3、可用的本地回环端口和 Unix socket。测试由包的 TestMain 清理真实
会话/凭据变量，隔离 HOME，安装假 CLI。ACP 服务端和 OneBot 都是夹具；没有真实 QQ
账号、模型请求、线上配置或事件数据。日志只记录合成消息。

```sh
# 仓库根目录；GOCACHE 可指向自己有写权限的缓存目录。
bridge/tests/qq-resilience/run.sh \
  --negative-control 3dc707ef122d9ac1580713e75ff6dfbebc00cb72

# 验证从当前源码构建的候选 CLI，不安装到用户目录。
cd bridge
go build -tags no_web -o /tmp/qq-resilience-bothouse ./cmd/cc-connect
tests/qq-resilience/run.sh --binary /tmp/qq-resilience-bothouse
```

脚本保留并打印独立证据目录。`red.log` 必须包含上述三个用例的行为断言失败，编译失败
不算红例；`green.log` 运行六类故障和三条新回归，带 race；`binary.log` 记录实际 CLI
经配置加载、本地 `/send` API 和 QQ WebSocket 的结果。脚本不修改工作树，不删除证据。
回滚只需停止测试自己启动的进程（测试自动执行）并回退本 PR 的任务提交，无生产配置需还原。

## 六类场景与观测

| 场景 | 可执行测试 | 基线 / 本次观测 |
| --- | --- | --- |
| 慢响应、积压 | `TestQQACP/queue`；`TestSlowUpstreamWriteDoesNotStallOtherConversations`；`TestSlowReceiptDoesNotBlockOtherConversations` | 真实 ACP 适配器和 Engine 接六条 pending 群消息，保留合批；慢模型期间独立私聊完成；慢写、慢 echo 不吞掉另一会话的期限。原有覆盖均通过。 |
| 断连 | `TestQQACP/drop`；`TestDisconnectDuringReceiptFailsWithoutReplay`；`TestDisconnectedReceiptsReleaseWithoutReplay` | 工具后 ACP 断连不重放，下一轮可恢复；OneBot 未回 echo 的请求现在及时失败，重连不重放旧请求，新消息可发送。新回归红→绿。 |
| 限流 | `TestQQACP/retry`、`TestQQACP/limit`；`TestRateLimitedSendIsSurfacedOnceWithoutReplay` | 工具前 429 沿用 core 退避；工具后 429 不重放；OneBot 拒绝仅返回一次。原有覆盖通过。 |
| 取消 | `TestQQACP/cancel`；`TestCancelledMultiPartSendStopsRemainingBubbles`；两个 `TestStop*` | `/stop` 到达 ACP，取消后的正文不漏出；停止不再滞留 echo 或复活重连。原有覆盖通过，新回归红→绿。 |
| 发送者隔离 | `TestQQACP/queue`、`TestQQACP/media`；`TestMediaStaysInItsOwnConversation` | 独立私聊不被慢群会话阻塞；并发图片按两位发送者路由。原有覆盖通过。 |
| 纯媒体 | `TestQQACP/media`；`TestMediaOnlyTurnSendsNoEmptyBubble` | 真实工具 `/send` 发图后以 `NO_REPLY` 收尾，每人只有一张图，没有空文本气泡。原有覆盖通过。 |

原有用例在基线为绿，称为覆盖证据，不冒称本 PR 的红绿回归。纯媒体覆盖的是已有工具
与 `NO_REPLY` 契约；图片之后 ACP 完全空正文、原生 ACP 图片块未覆盖。

## 组件适用性

以下是依据宿主契约作出的取舍，不是对这些组件的通用评价：

- 沿用 [gorilla/websocket](https://pkg.go.dev/github.com/gorilla/websocket#hdr-Concurrency)
  的单写者约束、并发 Close 与 DialContext。已有写信号量/期限负责写入，标准库 context
  和每连接关闭通道负责生命周期，足以修复已测故障，无须新依赖。
- 不叠加 [cenkalti/backoff](https://github.com/cenkalti/backoff)：其 Retry 会重做操作；
  ACP 整轮重试已经由 core 管，OneBot 写入后未回执不能证明未送达。再包重试可能重复
  工具副作用或 QQ 消息。这里只重连传输，不重新提交请求。
- 不添加 [sony/gobreaker](https://github.com/sony/gobreaker)：其阈值和开/半开状态需要
  明确失败域。本轮证明的是单 socket 生命周期缺口，没有测得跨会话熔断阈值；共享
  breaker 还可能将某次取消扩大成其他发送者的拒绝。
- 不引入备用 provider 或无限队列：本轮故障不需要更换模型供应商；已有 core 有界队列
  和群溢出保留机制维持原契约。

## 验证与保留边界

- 本机 macOS arm64：六类基线覆盖通过；最终测试配旧 `qq.go` 三条红例均复现；修复后
  定向 race 和 QQ 整包 race 通过，`go build -tags no_web ./...`、`go vet -tags no_web ./...` 通过。
- 候选二进制 `TestQQBinary` 通过：CLI 在一次实测中 18ms 返回 `delivery unknown`，
  重连前后上游仅收到原消息一次，下一条新消息成功；此耗时不是性能保证。候选使用临时
  配置，模型边界为夹具，没有运行真实模型或真实 NapCat。
- 全量 `go test -tags no_web -p 1 -count=1 ./...` 已跑完：47 个包通过，2 个包失败，
  共四条失败用例，均在未修改的上述基线独立工作树复现，未放宽断言：
  `TestSetupCLIsHint` 的空 PATH 仍发现本机 DSH/WorkBuddy，预期 `[]` 不成立；
  `TestOpenDSHWebReadsTheLaunchdLogWhenTheStateFileRecordsTheDefault` 与
  `TestPanelOpenEntryAdoptsTheLaunchdHost` 没接管假 launchd host；
  `TestDSHWebSelfHealFindsARestartedHostOnAnotherPort` 返回 503 而非 200。
  独立 `go test -tags no_web ./core -run '^TestCUJ' -count=1 -timeout=180s` 通过（23.902s）。
- 全量测试产生的 `contrib/lead/__pycache__` 曾阻止后续 Go embed 编译；将该生成目录
  可逆移到工作树外后，设置 `PYTHONDONTWRITEBYTECODE=1` 重跑 CUJ 通过。新脚本沿用 CI
  的该设置。没有把首次编译失败记作测试通过。
- 未在 Windows 执行，不声称正式签名包、真实 QQ/NapCat 或原截图同请求因果链已验。
  未改变既有单次发送的写名额/写入/回执期限；仍慢但未断开的连接由现有期限收口。
- draft PR 交固定完整 SHA 给未参与实现的成员复核。独立验收完成前保持 draft 和
  `Refs #819`；不关闭 issue，不部署、不重启生产。
