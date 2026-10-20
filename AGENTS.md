# 共栖 · Agent 协作入口

先读 README.md 与 docs/HANDOFF.md；目标/验收读 docs/GOALS.md 和 docs/STATUS.md，模块边界读 docs/ARCHITECTURE.md。开始前核对分支、HEAD、差异和对应 Issue/PR；交接是带时间的证据，不代替现场。

- 中文沟通，从目标、输入、输出、反馈判断方案；目标不清先讨论，目标清晰就选择最短可验证步骤。
- 新工作使用 CONTRIBUTING.md 的 Issue→分支→PR→验证流程。桥接实现还须读 bridge/AGENTS.md；新项目流程以根目录规范为准，上游历史说明保留在 bridge/。
- 默认自己完成任务。仅当前真人明确授权时按 skills/project-subagents/SKILL.md 派工；同一文件同一时间一名写者。使用独立 worktree 隔离并行写入，保护未提交工作。
- 当前生产仍在旧目录。开发构建不是部署；操作运行配置、进程或真实频道前核对用户授权与唯一操作人，凭据和完整对话不得入库。
- 验收要求、测试沙箱和每晚追加的教训见 [docs/code-standards.md](docs/code-standards.md)，提交 PR 前按它自查。
- 修复行为须有能复现原问题的回归验证；如实报告失败/跳过。初始导入的已知 Go 基线失败见 docs/GO_TEST_BASELINE.md，不据此放宽后续变更的验收。
- 实质进展后更新 docs/HANDOFF.md；能力证据更新 docs/STATUS.md，用法更新 README，边界变化更新架构。任务进度以 Issue/PR 为准，不复制多份待办。
- 禁止批量、递归、通配符删除及删除目录，禁止 sudo 删除。普通文件只能逐个明确路径，先说明完整路径并确认其为普通文件；需要清空目录时交由用户手动操作。
