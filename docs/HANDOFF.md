# 共栖当前交接

更新：2026-10-16，Asia/Shanghai。当前任务：Issue #15 CosyVoice本机试听。

## 最新进展：Issue #15

- 用户要求试听GitHub候选CosyVoice。独立worktree：/Users/zhaixinyang/conest-issue-15，分支experiment/15-cosyvoice，从已合并PR #14的b280972f开始；Issue #3已关闭。未修改主目录并行文档、PR #12/#16或旧生产配置。
- 已在M3 Pro / 18GiB本机用固定社区mlx-audio-plus源码与CosyVoice3 FP16生成4个WAV（短句首次/预热、安慰句、中英混合句），并用现有Qwen3-TTS生成同文对照。模型、环境和音频只在.local/cosyvoice/，不进入Git。源码、复现步骤与结果见[试听记录](COSYVOICE_TRIAL.md)。
- CosyVoice预热后三句耗时3.140/4.618/6.194秒，对照Qwen为3.232/2.928/3.815秒，只算合成；没有整体速度优势。两者音色不同，主观自然度待用户听。CosyVoice短句专名的ASR回查有歧义，不能写成全部发音合格。
- 初次完整加载因社区包间接缺torch失败，独立环境补齐并固定依赖后退出0。8个WAV验证、离线识别回查、依赖/语法检查已完成，原始失败保留。社区实现不是官方CUDA性能；未测流式/打断/真人麦克风/全链路。
- 本任务自行复核，未派生子Agent；PR最新SHA、CI和合并结果以Issue #15关联PR为准。生产仍使用Qwen，未重启服务或投递Discord。Issue #4保持开放，后续接入先看用户试听反馈。

## 前一阶段：Issue #3

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
