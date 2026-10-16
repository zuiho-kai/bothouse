# Issue #13 部署与独立复核

## 当前结论

2026-10-16 21:26（Asia/Shanghai），另一工作线已将PR #18的空响应及真实额度修复部署至旧生产路径。本验证工作线随后发现这一变化，停止使用旧候选，完整同步main并独立验证现有部署；没有再次停止或替换生产进程。

**部署已完成、基础健康复核通过；真人Discord工具审批和真实回答验收尚未完成。** GitHub Issue #13被PR #18的Closes自动关闭，不能据此推断真人验收通过。

## 版本与备份

- 发布源码：7027a4a15b1212379604819860eadb5bfc7c8028（PR #18）。
- 生产二进制：/Users/zhaixinyang/cc-connect/cc-connect，权限0755。
- SHA256：f3acbb3e2fdebba6031c277a81dddba53582432a309503471a6a3e61325b845c。
- 旧版本SHA256：7ac1caad1939f5a6b4b9df120e73dba24037cfad50e57f2b162da9247584cc1f。
- 备份：~/.cc-connect-maomao/backups/quota-20261016-212557/，包含旧二进制、config.toml、六份持久会话和deployment.json。二进制保留0755，配置/会话/记录0600。
- 部署记录：原PID80706，当前核对PID76033，启动时间21:26:04；PID是时间快照，后续操作必须重查。
- 启动方式：独立后台进程，原cwd，--config /Users/zhaixinyang/.cc-connect-maomao/config.toml，stdin=/dev/null，stdout/stderr均指向run.log。记录中的日志偏移329545之后包含旧进程正常关闭和新进程启动；历史日志仍保留。

从干净发布源码目录独立执行下述构建，产物与生产二进制SHA256完全相同；不是只相信版本字符串：

~~~sh
go build -tags no_web -ldflags '-s -w -X main.version=conest-20261016 -X main.commit=7027a4a15b1212379604819860eadb5bfc7c8028' -o /Users/zhaixinyang/conest-issue-13-deploy/.local/current-production-rebuild ./cmd/cc-connect
~~~

此前从旧生产源码重建7ac1caa…也与旧运行版本一致，502个Go/模块/模型技能文件与导入基线一致。当前发布保留模型切换、语音严格续接、共享记忆、子任务授权约定和调度；PR #20相对于该发布只增加测试隔离、审批合同回归和文档，没有额外运行时行为改动。

## 独立复核

- 六个Engine启动、六个不同Discord bot连接；从本次部署偏移开始未发现ERROR/panic。
- Unix API /sessions、/cron/list、/timer/list返回200。/sessions启动后为null是懒加载，不据此认为会话丢失。
- 六份持久会话的agent_session_id及active_session映射与部署备份逐一相同。
- 配置字节与备份一致，SHA256 0fd337545c4c6a2ff2dfb89bc20be9e9c31d866c7124f70c850f62f21aadca16；权限0600，G哥仍suggest，大豆包仍default。
- 独立再次GET六个/model/info均200；模型数依次cjiang=5、gge=18、cursor=46、grok=2、gjiang=4、deep=6。没有执行模型切换或推理请求。
- 六份team心跳新鲜且busy=0；语音8787/api/config正常、默认gge、无active_turn。语音与活动配置mtime早于此次部署，未重启Python语音服务。
- /cron/list仍有1项，/timer/list无待触发项；调度定义保留。调度文件的last_run等字段会正常更新，不以全文件哈希变化判断丢失。本线没有备份前完整调度定义快照，不能把API存活等同每次活动已成功；日报验收仍由Issue #7跟踪。
- restart_notify不存在。本线没有调用聊天接口或发Discord消息，没有修改LuLu、权限模式、配置、会话或其他任务源码。

脱敏复核记录在 /Users/zhaixinyang/conest-issue-13-deploy/.local/current-deployment-verification.json；原部署记录含会话标识，只保存在私密目录。

## 本地检查与限制

同步7027a4a…后重新执行原TCP审批、完整CUJ、默认包并发全量Go、相关race、三平台网络隔离race、vet及build，均exit0。命令与历史红绿证据见[验证记录](ISSUE_13_EMPTY_RESPONSE_VALIDATION.md)，日志均在同一worktree的.local/，名字以current-main结尾。

QQ/MAX/飞书测试曾误连公网；缺失fixture已修复，测试HTTP层在DNS/连接前拒绝意外外网并使包失败，不需要用户给测试程序放行。该保护仅作用于这三个测试包的默认HTTP客户端，不能声称系统已全局禁止所有测试外网。

曾有一次Codex假CLI的thread.started前置等待5秒超时，尚未进入Close断言。单项10次、整包3次及后续全量未再现，不能证明唯一根因。原始失败保留，未改Codex产品代码、删除测试或放宽超时；后续根因调查见[Issue #23](https://github.com/Zssan12/conest/issues/23)。当前部署由另一工作线先行完成，本线如实记录事后独立复核，不能倒写为本线在部署前完成所有门禁。

## 真人验收

由用户在“常规”发给大豆包：

~~~text
@大豆包 请只调用一次终端工具，执行：
git -C /Users/zhaixinyang/conest branch --show-current
把命令的实际输出告诉我。不要修改文件，不要开子 Agent。
~~~

若出现审批，选择“本次允许”，不选始终允许。若既有策略已经允许该命令而未出现审批，如实记录，不更改策略强行制造审批。

验收需要同时看到工具的实际输出和有正文的最终回答。按这一轮时间在私密run.log核对permission request与permission resolved的相同request_id；resolved只表示请求结束，不能单独证明用户允许。结合真人点击记录、工具结果和最终正文判断。也核对不会再次把空结果当成功，必要时保留经过脱敏的失败证据。未发生真人回合前，验收状态保持待完成。

## 回滚边界

若发布出现回归，先动态核对唯一桥接PID、各伙伴/语音忙闲和最新交接；正常SIGTERM停止，再用备份的旧二进制保权限复制到同目录临时普通文件后原子替换，按原环境/cwd/参数后台启动，run.log追加。保留最新config、会话、共享记忆与调度，不整体还原旧配置，不强杀活动任务，不使用会截断日志的旧restart脚本。此轮复核未触发回滚。
