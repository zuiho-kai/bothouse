# Issue #3：Go 测试基线诊断

日期：2026-10-16（Asia/Shanghai）。环境：macOS arm64，Go 1.25.14；开发分支 fix/3-go-test-baseline。本次没有运行真实模型、Discord 或重启旧服务。

## 根因和修复

| 失败 | 可复核证据 | 修复 |
| --- | --- | --- |
| launchd 用户域状态 | 原单测连续3次失败；Status先检查plist，但测试未建plist且读取真实HOME | 临时HOME内建立安装fixture，再验证用户域回退；不修改实际状态判断 |
| media_pipeline 临时目录清理 | 重复10轮复现；新测试在回复发送处阻塞，旧Stop仍立即返回 | 关闭消息入口、取消、关闭会话，并等待已登记的消息/队列/压缩/事件读取及Send工作完成 |
| CUJ图片/文件清理 | 全量与-race检查分别复现A3/A5的directory not empty | CUJ创建的引擎注册Stop清理，确保先结束写盘再回收TempDir |
| OpenCode缓存刷新 | 重复运行复现磁盘已新、内存仍旧；旧Stop回归测试返回时refresh仍运行 | 缓存测试等待真实刷新完成；Stop取消并等待刷新，禁止关闭后再启动后台刷新；测试注册清理 |
| CLI进程超时 | 并行探针：执行8个新建脚本各需1.940–4.503秒，同内容经/bin/sh运行需0.004–0.023秒；串行Codex又通过 | 测试明确用解释器执行fixture，并减少不必要的cat/sed进程；原1.5/2/3/5秒上限未增加 |
| 模型查询命令参数 | 新回归证明Codex查询配置忽略自定义cmd，OpenCode模型发现丢弃前置args | 两条查询路径保留配置的可执行文件及参数，与发送路径一致 |
| Antigravity失败被报成功 | exit 7且无stderr时，旧实现输出EventResult；新测试修复前失败 | 非零退出始终输出EventError，且不再补发成功结果 |

脚本探针证明的是本机“直接执行新建脚本”路径的启动延迟，不足以归因到某个macOS安全服务。历史每一次超时没有完整进程追踪，不能断言都来自同一个系统组件。受控cat/sed延迟实验解释额外子进程的影响；去掉它们后仍在负载下失败，最终显式解释器执行才稳定。

## 回归与验证

修复前已经运行并失败的回归：

- TestStopWaitsForMessagePersistence：在真实Engine→Platform回复边界暂停，Stop必须等待回复后的持久化；关闭后拒收消息。
- TestStopCancelsModelRefresh：真实测试子进程阻塞时Stop必须取消并等它退出；再次刷新不被接收。
- TestSendReportsProcessFailureWithoutStderr：非零退出不得成为成功。
- TestAvailableModelsPreservesCommandArgs、TestGetModelAndReasoningEffort_FromRuntimeConfigWhenUnset：配置的命令/前置参数必须用于查询。

本机已通过：launchd与media包各重复10轮；媒体-race重复5轮；media/opencode/daemon整包-race；core的TestCUJ与TestLocalInput在-race下通过；慢cat/sed干扰下相关Antigravity/Codex用例连续3轮通过；go build与go vet（均-tags no_web）通过。

macOS全量 go test -tags no_web -count=1 ./... 已通过（退出码0，不使用-p 1）。最终OpenCode整包及Antigravity/Codex相关进程回归的-race检查也通过。

Linux Ubuntu 上游 DSH 项目（未公开）的 CI run 38894302371 在代码提交 8c860baf8fd541a0cb6d2f3a9a3a63835e6d7cfd 上通过：go mod verify、go build -tags no_web ./...、go test -tags no_web -p 1 -count=1 ./...，companion检查也成功。本次没有更改CI并发策略或放宽门禁。最终提交检查、自查与合并证据在 PR #14。

## 本机证据索引

旧日志在 /path/to/conest/.local/bridge-tests.log、bridge-failure-check.log。本次日志在 /path/to/conest-issue-3/.local/，不提交完整运行日志：

- launchd-before.log、media-before.log、adapters-before.log：原始失败复现。
- shutdown-red.log、opencode-stop-red.log、antigravity-exit-red.log、command-args-red.log：回归修复前失败。
- slow-tools-red.log、slow-tools-green.log：第一次减少外部子进程仍不足，保留失败结果；interpreter-green.log：最终解释器方案3轮通过。
- lifecycle-after.log、media-race.log、race-final.log、core-race-joined.log：生命周期与竞态检查。
- full-mac-after.log、full-mac-final.log：中间全量失败，包含后来发现的CUJ与其他fixture启动问题。
- full-mac-verified.log：最终全量通过记录，退出码0。

Stop现在会等待已接收的消息处理结束。如果第三方适配器忽略取消且Close也不释放阻塞，关闭会等待它；不再用“已经返回”掩盖仍在写盘的工作。这不是所有后台任务的全局重构，也不代表已验证生产服务或真实语音体验。

## 2026-10-29：Issue #648 的 develop 基线

PR #669 的 Actions 40894601203 与其基线 `7af64faf` 的 Actions 40887009892 有相同的工作区、汇报、任务板和向导失败；不是 Codex 型号查询改动引入。本次修复从 `91c640a2` 开始，保留已合入的单任务工作区、共享工作区池、带任务编号的汇报、精简任务板和默认额度页脚规则。

- 工作区测试用空闲分配记录准备派工目标；`ClaimTeamWorkspace` 已经创建交接，不能再当空闲 fixture。容量、跨频道拒绝和重试检查继续保留；CLI 回归通过实际 `NewTeamWorkspace` 分配目标。
- 创建失败/异常测试先清空模拟工作区池，确保真的调用平台创建；永久失败测试的等待有超时及解除阻塞清理，避免复用池中的工作区后一直等待一个不会发生的创建。
- 汇报 fixture 使用存在的任务编号；保留未编号提问先退回两次再走兼容路径的验证。任务板断言对应简洁布局，历史已完成记录仍读取但不重新出板。
- 修复两个实际缺陷：简洁任务板截断后统计遗漏数量；DSH 的 `[ask] #N` 暂停编号指定的任务，而不是同工作区最近更新的另一件任务。内嵌协作脚本同步更新，客户端由锁定依赖重新构建。

行为回归先红后绿：`TestCompactBoardOverflowCountsRunningAndWorkspaceRows` 原输出 `…还有 0 件放不下`；`[ask] headline #N pauses that task, not the room fallback` 原断言目标任务 `paused_at` 非空失败。修复后对应回归与工作区/汇报/CLI 定向测试通过。Linux Node 24 协作测试 295/295、频道客户端 196/196，以及 CI 的八组 Python 检查通过；全量及最终提交的检查结果以关联 PR 为准。测试使用隔离状态与模拟平台/模型，不证明生产部署已验证。
