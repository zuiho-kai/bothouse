# 共栖当前交接

## 2026-10-16 21:33：Issue #13 已由另一工作线部署，本线完成补充验证

核对现场发现 PR #18 已合并为 7027a4a15b1212379604819860eadb5bfc7c8028，并于21:26完成部署。当前桥接PID76033，二进制SHA256 f3acbb3e2fdebba6031c277a81dddba53582432a309503471a6a3e61325b845c；备份及部署记录在 ~/.cc-connect-maomao/backups/quota-20261016-212557/。本线已只读核对六个Discord连接、配置字节与六份会话映射；独立重建产物与生产SHA256完全一致；同步最新源码后的原TCP、完整CUJ、全量Go、相关race、vet和构建全部通过。不要用旧候选dd9d752f覆盖已经上线的额度功能，也不要重复重启。

PR #20（deploy/13-empty-response，/Users/zhaixinyang/conest-issue-13-deploy）同步最新main，完整保留其业务代码，仅补审批合同回归、QQ/MAX/飞书本地HTTP测试隔离及验证文档。测试误连bots.qq.com和unused的根因已定位为fixture缺失，修复前网络保护明确报错，修复后通过；没有修改LuLu/权限策略。历史TCP监听限制已解除，原TCP、完整CUJ、默认并发全量Go、相关race和vet已在此前候选通过，同步后的相同检查也全部通过，详见[部署复核](ISSUE_13_DEPLOYMENT.md)。一次Codex假进程启动5秒超时没有稳定复现，保留原始失败与复核边界，未延长超时掩盖。

部署成功与真人验收分开：目前未发送Discord测试消息，仍待用户亲自对大豆包发起一次只读工具任务并核对正文/审批。先前独立验证提交07700992及红绿证据见[验证记录](ISSUE_13_EMPTY_RESPONSE_VALIDATION.md)，下文“未部署”是PR #18发布前的历史快照。

## 2026-10-16：大豆包空响应与额度状态（Issue #13）

本轮在独立分支 `fix/13-response-usage` 修复源码，关联 [Issue #13](https://github.com/Zssan12/conest/issues/13)，通过 [PR #18](https://github.com/Zssan12/conest/pull/18) 交付。未修改私密配置、旧源码或运行进程，未发送真实 Discord 消息；合并和部署均须另外核对，不能把以下测试当成线上已生效。

- 现场配置核对：大豆包走 Antigravity 的 stream-json；Cursor 走 ACP 且 auth_method=cursor_login。现已接入真实额度：Cursor 使用账期接口并按响应选择模型额度池；大豆包使用自己会话的 CLI 本地配额接口，覆盖 Argon 独立周额度。上下文占用不用于推算余额。
- 空响应证据：19:16:33 的本机 CLI 日志显示 print 模式对工具确认执行 soft-deny，同一时刻桥接把 11 字节的空响应占位符记为正常完成。源码在桥接已批准后返回 `allow`；[官方 PreToolUse 文档](https://antigravity.google/docs/hooks/) 说明该值仍委托默认权限策略，而 `auto_approve` 才表示已批准（仍遵守显式规则）。已修正转换，鉴权、用户拒绝和 pending request 校验保留；未启用跳过全部权限。
- 空结果兜底：没有非空白正文的 SUCCESS 转为可本地化的错误；不写成功历史、不自动重发工具任务。纯空白流片段不再遮掉最终正文。同一进程下一轮和引擎排队继续的回归通过。
- 额度反馈：普通消息、富卡片、缓存 token 状态行独立展示额度；明确区分“额度暂不可查询”“额度暂无数据”“额度查询失败”和真实剩余比例。查询失败不继续冒充上次成功余额；上下文仍按原有口径显示，额度带独立标签，遵守原有状态栏开关。
- 真实接口验收：2026-10-16 20:29 前，新代码分别成功读取当前 Cursor 模型所属池与 Gemini 4 Argon 周额度。Cursor 在 macOS 继承系统 HTTPS 代理，3 秒状态栏预算下查询成功；大豆包启动隔离空闲 CLI 验证本地鉴权/RPC后关闭，没有提交推理轮次。模型/Agent 缓存隔离、零额度、未知数值及周额度优先级有回归。详见 [额度查询说明](QUOTA_REPORTING.md)。
- 尚未验收：旧服务部署及真人 Discord 回归；Cursor 企业团队/PAC代理、Antigravity 非 stream-json 与其他操作系统。内部接口可能随 CLI 升级变化，失败时明确提示；不要将账户数据接口实测写成频道已上线。
- 已验证：旧代码的审批 relay、空结果/缺失额度、两个后端缺失 UsageReporter 回归均出现预期失败；修复后通过。Go 构建、vet、CUJ、相关竞态测试、按 CI 方式执行的全量（no_web、-p 1、-count=1）通过；两个真实接口只读验收通过。首次将全量与 race 同时运行时，Claude 孙进程重复 kill 出现 operation not permitted，Codex 进程重叠用例等待 thread id 超时；未改这些包，随后完整串行运行通过。原始日志留在本机 /tmp/conest-real-quota-*.log。更早同步 main 前的 launchd 等失败属于前序检查记录，已纳入 PR #14 基线。

恢复时先查看 Issue #13 对应 PR 的最新 SHA、CI 和部署记录。自动测试使用本地模拟 CLI/平台，另有显式只读真实账号验收；两者均未提交真实模型推理请求。不要将本轮自动化验证描述为真人 Discord 验收。

## 前序交接：Issue #15（已通过 PR #17 合入主分支）

- 用户要求试听GitHub候选CosyVoice。独立worktree：/Users/zhaixinyang/conest-issue-15，分支experiment/15-cosyvoice，从已合并PR #14的b280972f开始；Issue #3已关闭。未修改主目录并行文档、PR #12/#16或旧生产配置。
- 已在M3 Pro / 18GiB本机用固定社区mlx-audio-plus源码与CosyVoice3 FP16生成4个WAV（短句首次/预热、安慰句、中英混合句），并用现有Qwen3-TTS生成同文对照。模型、环境和音频只在.local/cosyvoice/，不进入Git。源码、复现步骤与结果见[试听记录](COSYVOICE_TRIAL.md)。
- CosyVoice预热后三句耗时3.140/4.618/6.194秒，对照Qwen为3.232/2.928/3.815秒，只算合成；没有整体速度优势。两者音色不同，主观自然度待用户听。CosyVoice短句专名的ASR回查有歧义，不能写成全部发音合格。
- 初次完整加载因社区包间接缺torch失败，独立环境补齐并固定依赖后退出0。8个WAV验证、离线识别回查、依赖/语法检查已完成，原始失败保留。社区实现不是官方CUDA性能；未测流式/打断/真人麦克风/全链路。
- 本任务自行复核，未派生子Agent；PR最新SHA、CI和合并结果以Issue #15关联PR为准。生产仍使用Qwen，未重启服务或投递Discord。Issue #4保持开放，后续接入先看用户试听反馈。

## 前序交接：Issue #3（已合入主分支）

- 独立worktree：/Users/zhaixinyang/conest-issue-3；分支fix/3-go-test-baseline，从origin/main的8c040812开始。主目录的未提交语音文档未修改。
- 已修复launchd测试隔离、Engine关闭时消息写盘竞争、OpenCode刷新回收/测试同步、CLI测试脚本启动延迟及模型查询命令参数丢失；Antigravity非零退出不再冒充成功。
- 代码提交8c860baf；[PR #14](https://github.com/Zssan12/conest/pull/14)交付。macOS全量（-count=1、默认并发）、构建/vet、关键-race/CUJ通过；Ubuntu [CI run 38894302371](https://github.com/Zssan12/conest/actions/runs/38894302371) 的Go全量及Python检查通过。根因、修复前回归和中间失败见[诊断记录](GO_TEST_BASELINE.md)。
- 本任务自行复核，没有独立Agent审核。最终文档提交仍须通过CI后按完整SHA合并；当前合并结果和Issue关闭状态以PR为准。工作区保留，未清理或覆盖其他任务文件。
- PR #10已在2026-10-16合并，Issue #1关闭。当前不操作旧生产配置/服务，没有部署。根目录仍可能存在其他任务的未提交文件，恢复时先核对。

以下保留前一阶段的导入与工作流背景；当前验证以本节及Issue #3的PR为准。

## 已确认目标

名称共栖 · CoNest。用户确认独立新目录、整理后发布 GitHub，仓库私有。产品目标见 [GOALS.md](GOALS.md)，能力事实见 [STATUS.md](STATUS.md)。本轮授权的是源码与协作流程整合，不包含运行迁移。

## 当前交付

新工作区 /Users/zhaixinyang/conest；由 cc-connect maomao 克隆保留历史，bridge/ 导入当前桥接源码，companion/ 导入语音、活动、日报及测试。旧 Python 网页 demo 留在旧仓库。来源与基线见 [SOURCE_ORIGINS.md](../SOURCE_ORIGINS.md)。

初始导入时Python独立环境102项通过、1项跳过，Go构建通过；Ubuntu云端Go全量测试通过，但macOS当时失败。该历史失败已由Issue #3修复并完成双平台验证，详见状态表。快照复制后再次核对原源文件哈希，没有发现导入期间继续变化的文件。本地导入清单在 .local/import-manifest.json，未纳入 Git。

私有仓库 [Zssan12/conest](https://github.com/Zssan12/conest) 已创建并核对 private=true，默认分支 main，初始导入提交 e9f902d4。已建立 [Issue #1–#9](https://github.com/Zssan12/conest/issues)，入口见状态表。工作流通过 [PR #10](https://github.com/Zssan12/conest/pull/10) 交付：统一Agent入口、协作规则、模板、CI和主分支保护。本轮没有服务重启、配置替换、Discord投递或硬件操作。PR最新审核、checks与合并结果以GitHub为准，恢复前先核对分支和差异。

GitHub CI run 38889638594在0ed5b4f0上两项全部成功。本地actionlint、文档本地链接和git diff --check通过。main保护已通过API配置并回读：PR必经、bridge/companion检查绑定GitHub Actions且必须成功、分支与main同步、讨论已解决；包含管理员，禁止强推/删除，线性历史。仓库仅开放squash合并，保留分支。

PR #10只补充工作流文档、PR模板及仓库设置，已合并；Issue #3的业务修复单独在PR #14交付。当前所需批准数0，适配单账号协作；没有独立审核时须如实标注自查。具体步骤见CONTRIBUTING.md。旧源码和运行数据保留。

## 旧生产边界

- 桥接源码 /Users/zhaixinyang/cc-connect，maomao；产品扩展 /Users/zhaixinyang/yijiazi。
- 伙伴工作目录 /Users/zhaixinyang/agents-demo；私密配置和运行数据 ~/.cc-connect-maomao/。
- 原详细运维证据在 /Users/zhaixinyang/yijiazi/docs/HANDOFF.md；这里只记录接手所需索引，不复制会话正文或凭据。
- 2026-10-16 18:09:28 模型切换+子 Agent 共同版本已部署，历史PID80706；18:12六个bot只读查询通过。更早“候选待部署”记录已被该结果替代。
- 18:16活动主持人改为gge，18:19采集正常；21:00活动、22:00日报结果尚待检查。16:12/16:46脚本失败由用户确认也是额度不足，日志只证明exit1。
- 当前部署事实来自上述时间点的运维记录；恢复时重新核对进程与状态，不能把旧PID当实时值。

## 下一步

1. 恢复时核对Issue #15关联PR最新SHA、checks、自查与合并结果；试听音频在上述独立worktree的.local/cosyvoice/{cosy-samples,qwen-samples}/。先收真人自然度反馈，再决定是否接入。保护主目录未提交文件及其他PR的并行工作。
2. Issue #2配置可移植性由其他任务推进，先核对当前负责人；真实电脑语音/跨角色记忆仍按Issue #4验收。新任务按用户授权确定范围，试听实验不自动授权运行迁移。
3. 用小型真实项目验证Issue→分工→PR→测试审核。硬件采购放在电脑体验验收之后。

## 交给下一个 Agent

请先读 AGENTS.md、README.md、docs/HANDOFF.md；需要理解验收和边界时读 docs/GOALS.md、docs/STATUS.md、docs/ARCHITECTURE.md。核对当前分支、HEAD、未提交变化和实际Issue/PR，再继续一个有明确验收条件的任务。旧运行环境还在原目录，不把新仓库的构建视为已经部署；默认不启动子Agent，只有当前真人授权才派工。实质进展后更新本交接。
