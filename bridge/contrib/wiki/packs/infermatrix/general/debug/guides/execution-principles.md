---
name: execution-principles
description: 执行原则：最简单的有效路径、明确指令直接执行、漂移事实每轮重查、仓库知识写回仓库、远端先做只读探针、小兼容错误逐个收敛、Windows 文本显式 UTF-8
metadata:
  scope: 只收选择最直接执行路径的七条通用原则；定位漏斗归 debug-funnel-discipline，结论纪律归 conclusion-discipline
---
# 执行原则

## 关键事实

- 源页：`knowledge/general/debug/guides/execution-principles.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, debug；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 1. 使用最简单的有效路径

- 先检查现有环境、脚本、测试和成功入口。
- 已有可信 venv、仓库命令或复现脚本时优先复用；不要先用 `PYTHONPATH` hack、系统级升级或大范围兼容 patch 绕过问题。
- 简单不等于跳过门禁：目标仓库、用户范围、live 状态和验证要求仍然必须确认。

### 2. 明确指令直接执行，歧义才停下来问

- 用户已经给出目标、修改位置和期望行为时，按该方案推进，不额外开展无关背景实验。
- 只有下列情况需要先澄清：
  - 两种解释会改变公开行为或修改范围；
  - 操作不可逆或会影响他人状态；
  - 目标仓库、分支、环境或证据合同无法从 live 状态确定。
- 极短指令要结合当前任务链还原含义，例如“继续”“push”“用 B”通常承接上一轮已经确定的对象，不代表创建新的分支或方案。

### 3. 稳定流程可以复用，漂移事实必须重查

- 低漂移的方法、调试顺序和已验证 contract 可以直接复用。
- 以下事实每轮都要 live check：
  - 当前代码、branch、PR head 和 diff；
  - remote、Git/SSH 身份和权限；
  - 远端路径、venv、cache、GPU 和进程；
  - CI、artifact、服务状态和外部版本。
- 历史指南和错题用于缩短调查，不用于替代当前证据。

### 4. 仓库知识写回仓库

- 能改变下一次行为的结论先写最近 owner 的 `rules.md`；稳定职责写 `architecture.md`；需要展开的方法写 `guides/`。
- 只有复杂证据或历史过程有独立查询价值时才写 `incidents/`，当前机器事实写 ignored `local/`。
- 不要默认写系统、全局或个人 memory。
- 写入前查重复，更新最近的 `_index.md`，并运行知识树检查。

### 5. 远端先做最小只读探针

- 用户给出连接目标时，可以先做短超时、非交互、只读的连通性探针；不要在确认 host key、身份和目标归属前禁用安全检查或执行修改命令。
- 连接成功后再确认 cwd、版本、资源和运行方式。
- 需要写入、安装、启动服务或清理时，先满足对应远端规则。

### 6. 连续的小兼容错误可以逐个收敛

- 当每次失败都暴露一个独立、可验证的小型 API/version mismatch 时，可以 fix forward，但每个修改必须有 source contract 和最小验证。
- 出现以下情况时停止逐个 patch，重新评估：
  - 需要改变语义或公开接口；
  - 同一根因重复失败；
  - 补丁开始跨多个 owner；
  - 用户范围不允许继续扩张；
  - 环境本身不再可复现。
- 错误数量多不自动等于系统不可用，反复无证据 patch 也不等于坚持。

### 7. Windows 文本显式使用 UTF-8

- 在 Windows/PowerShell 读取或写入 UTF-8 文本时显式指定编码，避免规则、补丁和脚本因默认编码被误读。
- Python 的 UTF-8 环境变量不改变 PowerShell 文件 cmdlet 的编码行为。

```powershell
Get-Content -Path <file> -Encoding utf8
Set-Content -Path <file> -Encoding utf8
```
