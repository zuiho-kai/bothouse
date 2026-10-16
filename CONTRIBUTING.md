# 协作与交付

## 一次工作怎样结束

1. **Issue 定义问题**：写清真实现象/目标、输入输出、证据、完成标准和本次不做的范围。小修复可用一个短 Issue，避免无目标地增加功能。
2. **分支落实范围**：从 main 建 feat/、fix/ 或 chore/ 分支；在 Issue 留下负责者与文件范围。多人写代码用独立 worktree。同目录“大家都能写”不等于已经协调。
3. **PR 给出可审查产物**：关联 Issue；描述行为前后、实际验证、风险与回滚。完成功能用 Closes #编号；仅关联或部分推进用 Refs #编号。不要因有 PR 就提前关闭验收未完成的 Issue。
4. **验证与审核**：先检查差异和凭据，再跑相关测试。行为修复需回归测试；Go核心流程须跑 CUJ。父 Agent 对子任务负责，不能把子 Agent 的“完成”当验收。
5. **合并与部署分别记录**：审核与相关检查通过后合并。部署单独记录配置、二进制/代码版本、备份、回滚和真实入口验证；未部署就明确写未部署。更新交接后再换人。

初始源码导入直接形成 main 的来源基线；后续工作通过 PR。已知失败记录在仓库内部，后续不以“基线本来失败”为理由隐藏新增失败。

## 当前门禁与职责

GitHub 的 main 保护已启用：必须通过 PR，最新提交的 bridge 和 companion 检查都成功，分支与 main 同步，审核讨论已解决。规则包含管理员；禁止强制推送和删除 main，只允许 squash 合并形成线性历史。合并后保留任务分支，不自动删除。

当前按单一 GitHub 账号协作，不强制另一个账号的 Approved（所需批准数为0）。审核仍要逐项核对 Issue 的验收、差异、测试与风险，并在 PR 留下结论；同一 Agent 的自查要如实标注。独立审核或真人批准未发生时不能声称已发生。未来引入独立维护者时再启用至少一份批准。

CI成功仅允许继续审核，不能证明需求正确或生产已经可用。合并操作须在用户授权的任务范围内；默认不开子Agent，也不自动扩大到其他Issue。检查失败时停在PR，定位失败并修复，禁止使用管理员绕过或伪造成功检查。

## 一次任务的最短操作

1. 读取 Issue 与项目入口，检查工作区差异；写清负责人/可写文件。同一批文件已有写者时先协调，不能覆盖。
2. 获取 origin/main 后，在干净工作区创建含 Issue 编号的任务分支，例如 fix/2-instance-config；有未提交工作时保留并使用独立 worktree。
3. 小步修改与验证，提交后推送任务分支；用 gh pr create --draft 创建草稿，正文写清 Closes #编号或 Refs #编号、验证结果、风险和是否部署。
4. 核对最终差异和最新提交的检查。审核结论记录在 PR；准备好后用 gh pr ready 标记可合并。
5. 合并时使用 gh pr merge --squash --match-head-commit 指定刚审核的完整提交SHA，防止审核期间的新提交混入。保留分支，不使用管理员绕过；完整解决的 Issue 由 Closes 自动关闭。
6. 核对 main 上的合并结果；只在工作区干净时切回 main 并快进。交接记录说明对应 PR、验证范围、未完成项和部署状态。需要部署时另开明确任务，不把 merge 当 deploy。

这是可手动执行、由 Agent 理解任务的协作流程。尚未实现 bot 自动认领Issue、自动创建或合并PR；真实项目闭环在 Issue #6 验收。

## 验证命令

基础开发命令见 README。桥接相关的补充检查在 bridge/ 内运行：

~~~sh
go test -tags no_web ./core -run TestCUJ -count=1
go test -race -tags no_web ./core ./agent/acp ./agent/codex ./agent/antigravity -run 'Test(ModelSwitchPrompt|Send_ModelSkill|DefaultPreambleIncludesModelSkill|PreparePromptIncludesModelSkill|ResolveModelQuery|QueueModelSwitch|EffortVariant|ParseModelInfo)' -count=1
~~~

CI 在 Ubuntu 上构建并执行 Go 全量测试（-p 1降低跨包并发干扰）与 Python 独立环境测试，不调用真实 Discord、模型或麦克风。测试失败使任务失败，没有 continue-on-error 或删测。macOS launchd、真机音频、真实 CLI 身份与额度需要单独验收；Ubuntu CI 不能证明这些通过。

2026-10-16的Ubuntu云端Go全量与Python检查均已通过。本机macOS Go基线仍有失败，Issue #3继续处理；本次工作流PR不修改这些业务源码。平台门禁和人工验收分开：前者已启用，后者需要实际记录。

## 数据与来源

仅提交代码、脱敏示例和必要测试 fixture。运行日志、对话、录音、模型、令牌、个人 CLI 配置留在 Git 外；不要输出它们来证明自己做过检查。代码来源和许可缺口见 SOURCE_ORIGINS.md。上游历史配置文件可能仍在 Git 历史中，当前仅做过有限模式扫描，不声称完成全面历史审计。
