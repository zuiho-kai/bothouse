# 有回答的失败回合（Issue #34 后续）

## 2026-10-20：当前命令非零退出的定位（Issue #172，未部署）

本次在独立工作区、基于 main `e2af6d64`，只读核查生产 `eecbab26` 的日志及其拥有的原生 CLI 认证轨迹。轨迹为 IDLE、6998/6998 步，身份与指定会话一致。没有重跑真人任务、发送 Discord 消息、改配置或重启生产。下面只保留命令类别、步骤和退出码，不保存原始轨迹、对话、路径、凭据或工具输出。

| 北京时间 / 当前轮 | 原生失败证据 | 后续证据与结论 |
| --- | --- | --- |
| 16:02:56 / 6762–6795 | 6792：`git -C <目录> status`，exit 128，原生诊断为非 Git 仓库 | 6794 是目录列举、exit 0；不是相同 Git 操作成功，不能抹掉失败 |
| 16:13:16 / 6796–6846 | 6824：`grep -rn <模式> <文件>…`，exit 1；6834：另一条 grep（隐藏 stderr），exit 2；6836：`git log <revision>…`，exit 128，原生诊断为无效 revision | 搜索无匹配候选与搜索执行错误并存；Git 后续不同查询成功，不证明原 revision 有效 |
| 16:24:11 / 6847–6949 | 6851：Python 测试脚本 exit 2，缺必填 `--output-dir`；6871：进展上报 exit 1，summary 参数要求未满足；6933：`ninja -C <目录>` exit 127，原生诊断为 command not found | 6855 同脚本补 `--output-dir` 后 exit 0；6873 补 `--message` 后 exit 0；6937 添加 PATH 后包含原 ninja 命令并 exit 0。这些是具体恢复线索，不是整轮所有操作均成功的证明 |
| 16:28:48 / 6950–6997 | 6962：`git show <revision> | grep -A 20 <模式>`，exit 1 | 单个管道退出码缺少各阶段退出信息，不能证明上游 Git 成功；6966 的另一条 grep exit 0 也不能证明原管道正确 |

四次桥接均记录 `trajectory-command-failed`。这次不属于已经修复的“仅历史 ERROR_MESSAGE 污染当前干净轮次”：当前每轮确有非零命令。原来的不足是把所有情况压成同一句 `stream turn failed (ERROR)`，且只留下第一个拒绝原因，无法定位哪个步骤、多少条命令失败。`DONE` 仍然只表示命令结束。

本次修复诊断根因，**不把这些回合改成成功**：

- 先核对完整空闲轨迹、会话、回合边界和最终正文，再提取当前轮非零命令；历史步骤不计入。`EventError.Error` 附首个 `command_step`、`exit_code`、固定 `kind` 和 `nonzero_commands`。有公开回复时末尾警告仍沿用 core 当前设计，本次未改频道呈现。
- 日志枚举最多 8 条失败命令，仍统计全部非零命令。只记录整数、固定类别和轮次范围；不输出命令、工作目录、shell 名称、原生错误正文、最终答复或认证信息。
- `search-no-match-candidate` 是诊断候选，不能证明具体可执行文件身份、shell 运行语义或 CLI ERROR 的唯一来源；含管道、重定向、替换等语法归入 `shell-or-unknown`，不尝试实现 shell 解释器。`exit-127` 也只陈述退出码，不把任意程序的 127 一律解释为命令未找到。
- 原始命令、cwd、shell 完全相同且后续步骤明确 DONE/exit 0 时，只记录 `later_same_command_zero_step`；`-1` 表示没有这种严格匹配，**不表示没有恢复**。模型自述、改参数的不同命令、无关成功操作均不能消除早先失败或部分写入。
- 同轮既有非零命令、又有“停止已完成任务”的错误时，非零命令不能被后者的专用诊断掩盖。原有回答保留、失败事件、排队释放、历史干净轮次恢复和认证 RPC 预算不变。

安全边界决定本次不能“修掉”真实操作失败：桥接没有原任务目标或命令后置条件，缺少管道各段状态，也不能从模型答复证明恢复。修复 Git 目录/revision、脚本必填参数和构建 PATH 需要执行侧正确调用及对应任务验证；本子任务没有重跑原任务或修改生产环境的授权。仅凭 grep/后续成功放行，会掩盖真正写入失败。Issue #172 仍需父 Agent 整合并决定后续执行侧修复与真人验收，不能按诊断增强关闭。

离线回归使用合成命令形态，不含生产数据。先运行以下单项，旧实现 7 个子例全部失败，典型输出为 `missing actionable native evidence "command_step=3 exit_code=128 kind=git": antigravity: stream turn failed (ERROR)`；修复后通过：

~~~sh
cd bridge
go test -tags no_web ./agent/antigravity -run '^TestCommandOutcome172_StreamReportsSafeNativeEvidence$' -count=1 -timeout=30s
go test -tags no_web ./agent/antigravity -run '^TestCommandOutcome172' -count=1 -timeout=45s
~~~

回归另覆盖同命令后续成功、不同参数/目录/shell、历史失败、错误/截断/跨会话轨迹、最终正文不符、日志上限与保密性、真实写入命令非零不能放行，以及非零命令不被已完成任务停止诊断遮盖。测试运行在包已有的临时 HOME/假 CLI 沙箱；不调用真实模型。

本机验证全部通过（2026-10-20）：

~~~sh
go test -tags no_web ./agent/antigravity -count=1 -timeout=180s
# PASS，48.267s
go test -race -tags no_web ./agent/antigravity -count=1 -timeout=240s
# PASS，53.212s
go test -tags no_web -p 1 -count=1 ./...
# PASS，仓库沙箱全量
go vet -tags no_web ./agent/antigravity
go build -tags no_web ./...
# 均 exit 0
~~~

未运行真实 provider/Discord 任务或生产入口回放；未部署。全量测试中已有条件跳过规则不代表真实账号验收。

## 已观察的根因

2026-10-17北京时间00:37:34，大豆包原生命令任务成功结束（DONE、exit 0）；00:37:40又调用manage_task kill停止它，被原生CLI拒绝：task is not running (status: DONE)。00:38:17最终回答生成完成。当前回合确有工具失败，不能当作纯历史错误改为成功。

旧适配器把result.response拼入错误信息；核心错误路径只显示错误，导致整段回答挂在❌前缀下，实际原因没有显示。PR #35的历史错误核验仍然正确拒绝本轮真实失败，这次补充输出和诊断合同。

## 修复后的行为

- Antigravity将回答放进EventError.Content，将安全诊断放进Error，两者分开。原始result.error、原生轨迹和工具输出不进入错误日志/钩子。
- Discord先展示已有回答，再单独提示“本轮有操作失败，以上回复不代表全部操作成功”。若能证明是停止已成功结束的任务，显示对应中文原因。模型和额度仍只有一份；富卡片成功更新时不重复发送正文。无正文的失败仍显示错误。
- 继续使用EventError；不发送成功反应、不写成功回答历史、不自动重试。存活会话继续处理排队消息。本地语音/input仍返回failed、空text，且不把语音内容发到Discord。
- 原生任务指引随每轮提示注入：先核对任务最新状态，DONE或已退出无需kill；检查与停止间发生结束竞争时，不重复kill。这是行为指引，不是原生CLI的硬性拦截；未修改原生CLI或权限策略。

## 安全诊断的边界

只向自己拥有的CLI子进程调用既有认证GetCascadeTrajectory；PR #71 对尚未落定的轨迹最多查询4次，间隔750毫秒，等待额度查询互斥锁、间隔和RPC共用10秒预算，每次响应上限64MiB。等待锁支持取消，不留下后台抢锁协程。正常SUCCESS不增加查询。

CLI为ERROR时，只有当前轮原生记录满足完整性、身份、最终回答匹配和干净结束条件，才允许修正为成功，不再要求CLI错误文本匹配历史错误。原生步骤DONE只表示执行结束；任何已知非零runCommand.exitCode都保留失败，不因最终回答存在而覆盖。

具体原因必须有完整空闲轨迹、当前输入/最后步骤/会话一致、最终正文一致，且仅一个失败步骤：manage_task Action=kill、TaskId精确指向同一回合之前的命令步骤、目标DONE且exitCode明确为0、原生shortError精确匹配。其余步骤全部DONE且无error。缺证据、不同会话、截断、其他失败或未知格式均保留通用失败，不推断安全原因。

stream的ERROR步骤被单独记录为failed；它仍禁止历史错误被改判成功，但允许上述只读原因核验。拒绝、取消和不完整身份继续保守处理。

## 回归与发布

合成fixture复现真实协议结构，不包含私人聊天、会话ID、工具输出或凭据。旧实现明确失败；修复后覆盖回答/错误分离、原因验证与拒绝未知原因、历史恢复边界、富卡片/回退、长回答分块、额度、队列/历史和语音失败隔离。

本机证据保存在工作区.local/：failure-red.log、failure-green.log、go-full.log、tcp-approval.log、cuj.log、race.log、final-regression.log、hook-race.log、vet.log、build.log。macOS全量、TCP审批、完整CUJ、相关race、hook整包race、vet与构建全部通过。race初次正则未选中hook用例，故另跑hook整包并通过；不把未选中当通过。macOS全量采用umask 022与go test -tags no_web -p 1 -count=1 ./...；串行包调度不跳过用例。最终SHA的Ubuntu CI以关联PR记录为准。

本次仅从包含PR #37/#38的main创建独立分支，不修改模型发现逻辑。部署需核对实际生产/唯一操作人、空闲、备份、二进制原子替换和六连接/API/配置会话连续性。合并、部署和真人验收分别记录在Issue #34与本机统一运维交接，不因测试通过宣称真人体验已通过。
