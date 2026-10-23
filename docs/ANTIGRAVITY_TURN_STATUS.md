# Antigravity 当前回合终态核验（Issue #34）

## 问题与根因

用户看到大豆包已经回答，却在开头带着 antigravity: stream turn failed (ERROR)。PR #29只修复错误回复的额度尾注，本问题独立跟踪 [Issue #34](https://github.com/Zssan12/conest/issues/34)。

2026-10-16/17，本机 agy 1.4.0 的结构化证据：早期会话有地区拒绝的 ERROR_MESSAGE；之后的新输入、工具读取与最终回答均已 DONE，CLI仍将早期错误复制到 result.error 并给出 ERROR。桥接只读 status/response，直接把这个终态当成本轮失败。

用生产会话的 SQLite 在线备份建立私密隔离副本（新配置目录、复制认证、禁用工具的诊断钩子），不写原会话或 Discord：

- 旧会话副本收到固定无工具提示，实际回答 CONEST_PROBE_OK，当前所有步骤 DONE，但终态 ERROR，error精确等于历史地区拒绝。
- 同环境、同模型、相同提示的新会话返回 SUCCESS。
- 最新生产会话的只读原生轨迹同样表明：当前回合已完成，错误步骤在更早回合。不能因此否认此前真实发生的地区拒绝，也不能把所有 ERROR 都归类为此问题。
- 修复后的实际适配器在同一个隔离副本连续两轮得到正确回答与 SUCCESS，原会话标识和进程保持，实际额度查询成功。未派生 Agent、未发 Discord 消息。

证据仅在本机：/path/to/conest-issue-28/.local/error-repro/ 的两份原始对照，以及 /path/to/conest-issue-34/.local/ 的红绿测试与真实适配器日志。原始轨迹、认证和思考不入库。测试中只使用合成的协议 fixture。

## 修复边界

只修正能证明属于历史污染的 ERROR，必须同时满足：

1. 本轮 stream 有明确的 user_input 起点、同一会话与单调步骤编号，最终 agent_response 为 DONE；不接受缺字段、跨会话、额外输入或失败状态。
2. 从**此会话拥有的 CLI 子进程**现有本地认证接口 GetCascadeTrajectory 读取新快照，不用历史缓存。只连接该进程的 loopback 监听端点，不走代理、不跟随重定向。
3. 返回完整且空闲的轨迹，最后步骤与本轮 stream 对齐；本轮全部 DONE，无 error/errorMessage；最终响应有已验证的正常 stopReason。
4. result.error 精确匹配本轮开始前的 ERROR_MESSAGE.shortError；本轮最终原生正文与 result.response 一致，仅允许首尾空白差异。agy会给result正文追加换行，不能以此误判不一致。

证明成立才生成正常 EventResult，写一条不含正文/凭据的核验日志。流式正文不重复，原有模型、额度、队列和历史流程继续工作。无证明、空响应、本轮错误、取消、权限拒绝、未知状态、超时、接口失败、不同正文全部保留失败；不自动重试模型，不清空会话或改审批。

接口为CLI内部接口，未来版本可能变化。核验总预算10秒、响应上限64MiB（原8MiB在约370步的长会话中被撑爆，导致核验全部失败）；不满足格式或容量边界时保留原ERROR，不能宣称所有后端失败都已解决。正常SUCCESS不增加此查询。

## 回归与验证

在 bridge/ 执行：

~~~sh
go test -tags no_web ./agent/antigravity -run '^Test(StreamSession_HistoricalError|StreamTurnEvidence|NativeTrajectory|NativeQuota)' -count=1
go test -tags no_web ./agent/antigravity -run 'TestAgyPermissionBridge|TestBridgeTokenEqual' -count=1
go test -tags no_web ./core -run TestCUJ -count=1
go test -tags no_web -count=1 ./...
go test -race -tags no_web ./agent/antigravity ./agent/antigravityhook ./core -run 'Test(Stream|Native|AgyPermission|BridgeTokenEqual|CUJ|ProcessInteractiveEvents)' -count=1
go vet -tags no_web ./...
go build -tags no_web -o ../.local/cc-connect-candidate ./cmd/cc-connect
~~~

旧代码的 TestStreamSession_HistoricalErrorDoesNotPoisonCompletedTurn 明确失败，修复后通过。覆盖本轮工具失败、拒绝/取消、旧错误不匹配、无错误字段、空/不同正文、未完成/截断/跨会话轨迹、未知结束原因、RPC失败、保密性、重定向、长度限制和连续查询不复用成功结论。

中间真实适配器复验曾失败：result正文比原生正文多一个换行。定位为协议呈现差异后只放宽首尾空白比较，新增回归；保留失败日志，没有放宽成功条件或盲目加超时。后续真实两轮复验成功。

2026-10-17本机上述检查全部通过（全量默认包并发，未跳过失败用例）。相关race命令未选中antigravityhook包的用例，另外执行该包完整race检查；真实账号opt-in测试仍按原规则跳过，不冒充执行。Ubuntu CI最终SHA及结果记录在对应PR；失败、跳过与真人验收不得混写。

## 发布和真人验收

发布结果、合并SHA、候选哈希、备份目录、配置/六会话/API检查以 [Issue #34](https://github.com/Zssan12/conest/issues/34) 为准。开发构建及隔离CLI成功不等于已部署，更不等于真人Discord验收通过。

发布时必须包含当前main的语音、模型切换、共享记忆与调度；核对唯一操作人和各伙伴/语音空闲后备份、正常停止、原子替换，日志追加。失败回滚二进制，保留最新配置与会话。

用户可在常规点名大豆包：只执行一次 git -C /path/to/conest branch --show-current，返回实际结果；不要写文件或派生Agent。如有审批只选本次允许。应看到实际回答与额度尾注，不出现虚假的ERROR；日志应有真实审批记录及必要时的历史错误核验记录。若本轮仍真实失败，保留错误继续诊断。真人验收未发生前Issue保持开放。
