# Antigravity 原生模型发现

2026-10-17，关联 Issue #5。代码修复与生产部署分开验收。

## 问题与修复

本机 `agy models` 能列出 `gemini-3.8-flash-high`，但桥接的 `AvailableModels` 没有调用原生 CLI：它优先读取显式 provider 模型配置，否则尝试公共 Gemini API，最后返回四个旧的硬编码 ID。模型切换命令按候选列表校验，因此拒绝了原生 CLI 实际提供的目标。

修复后继续保留显式 `providers.models` 优先；未显式配置时调用同一个 CLI 的 `models` 子命令。使用与会话相同的命令前缀参数、工作目录及配置/provider/session 环境覆盖顺序，不启动聊天或切换真实会话。

解析原生 CLI 的制表符分隔行，保留完整模型 ID、思考档位后缀及描述，不过滤非 Gemini 模型。忽略非数据行与重复 ID。查询最多 15 秒，调用方取消会提前终止；失败或无有效模型时返回空列表并记录不含 CLI 输出的警告，不再把公共 API 或旧硬编码列表作为已验证候选。旧 CLI 不支持 `models` 时需明确配置 `providers.models`。

这修复的是候选发现与切换请求校验，不改变自动分档策略，也不能凭排队成功证明下一轮后端实际使用了目标模型。

## 可重复验证

在 `bridge/` 执行：

```sh
go test -tags no_web ./agent/antigravity -run 'Test(AvailableModels|ParseCLIModels)' -count=1
```

关键回归 `TestAvailableModels_NativeCLIModelCanBeQueued` 使用假 CLI 边界与真实 Agent/Engine：CLI 提供目标 → ModelStatus 列出目标 → QueueModelSwitch 接受并排队 → 当前回合模型不变 → 未提供的 ID 仍被拒绝。旧实现实际运行失败，仅返回四个旧 ID；修复后通过。补测显式配置优先、命令/环境/目录一致性、失败/空输出、取消和解析。

本机真实探针调用新适配器及隔离内存 Engine，输出 `advertised_models=13`、`target_advertised=true`、`isolated_queue_ok=true`，目标为 `gemini-3.8-flash-high`。没有访问生产 socket、发送聊天或切换真实会话。探针源码保存在忽略的 `.local/models-probe.go`；其中的本机绝对路径不作为产品配置。

## 验证中的失败与边界

首轮环境回归因 macOS 临时目录路径别名失败，已改用实际目录身份比较；修正后定向测试通过。首轮默认包并发全量测试同时出现 Codex 的 `TestClose_ForceKillsAllTrackedProcessesAfterCmdOverwrite` 等待 thread ID 超时；未修改该后端，原日志保存在忽略的 `.local/go-test-full.log`。

最终验证：`go test -p 1 -tags no_web -count=1 ./...` 全量通过；Antigravity 模型发现与 core 模型切换、完整 CUJ 的定向 race 全部通过；`go vet -tags no_web ./...`、`no_web` 构建及 `git diff --check` 通过。日志分别在 `.local/go-test-final.log`、`.local/go-race-cuj.log`、`.local/go-vet.log`。这证明本次串行全量结果，不消除首次默认包并发发生的 Codex 超时记录。

以上为 PR #37 提交时的验证记录。PR #37 后已合并为 `af82b081675ab2ea0f30ce3ce9a7b8fd56f67ade`，2026-10-17 01:24 部署完成，生产只读列表确实返回13项。部署记录在旧统一交接；该次上线检查没有覆盖下面的真人连续操作失败。

## 后续：列表成功后切换仍失败（2026-10-17，Issue #5）

用户贴回完整输出：list 成功且包含目标，紧接着 set 退出2，提示 `no unique model matches`，没有候选。生产日志 01:36:23 同时出现原生发现失败 `signal: killed`；随后四次只读查询均成功。旧日志没有记录上下文错误或耗时，不能据此唯一断定是15秒超时、调用方取消还是外部终止；也未验证外层 `stream turn failed (ERROR)` 的独立成因。

确定的代码缺陷是 list 和 set 各调用一次外部模型发现；第二次失败返回空列表，core 将其误报成 ID 不匹配。回归测试让同一个 CLI 第一次返回目标、之后退出3，真实 Agent/Engine 按 list→set 连续调用，修复前稳定复现用户同一报错。此 fixture 验证失败传播路径，不冒称重现生产进程被终止的根因。

修复让同一查询环境的一次成功结果最多复用60秒，覆盖相邻 list→set，无需重启外部 CLI；显式 provider 列表继续优先。只留一份内存快照，不写磁盘；有效命令、参数、工作目录、provider 索引或配置/provider/session/继承环境变化均重新查询。环境按实际键值归一，顺序改变不影响命中；仅保留身份哈希及模型结果，不留凭据值。返回副本，调用方不能污染快照。过期不降级使用旧列表，失败不缓存，取消请求不返回缓存；取消及15秒超时策略不变。相同环境下外部账号状态/CLI文件变化最迟在60秒后刷新，因此短时快照只用于请求校验，不保证下一轮服务端一定接受。

无有效候选时改报“模型列表当前不可用或为空”，保持原模型及待切换状态，五种语言均覆盖。失败日志增加耗时与 context_error，后续可区分超时和取消，不输出 CLI 正文或环境。

验证入口仍为上文定向命令。两项新回归修复前失败，定向修复后通过；边界测试覆盖快照过期、查询环境变化、失败后可重试、列表副本与已取消请求。真实原生 CLI + 隔离 Engine 读到13项，list约7.94秒，随后目标排队校验约0.54毫秒，当前模型保持原值；没有访问生产切换接口或向真实会话发送聊天。探针与红绿日志保留在忽略目录 `.local/`。

本次相关 race、完整 CUJ、vet 与 no_web 构建已通过。首轮串行全量仅 daemon 的 `TestInstallLaunchd_TightensExistingPlistFrom0644` 前置失败：当前 shell 的 umask=077 把 fixture 新建文件变成0600，测试预期0644。未修改 daemon 代码、跳过测试或更改生产文件权限；保留 `.local/discovery-snapshot-full.log`，在测试子进程设 umask=022 后重跑串行全量全部通过，结果另存 `.local/discovery-snapshot-full-022.log`。最终CI与部署状态以交接和PR为准；尚未完成真人下一轮切换验收。
