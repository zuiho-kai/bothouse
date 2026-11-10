---
name: sandbox-runtime-rules
description: "sandbox-runtime 审查规则（PR #7821）：JW-SBX-SOFTDELETE-1a Windows 软删除受保护路径失败原地保留，JW-SBX-INJECT-1a 软删除注入遵守进程类型与位数边界"
metadata:
  scope: 只收 JW-SBX-SOFTDELETE-1a 与 JW-SBX-INJECT-1a 两条规则（触发、强制、禁止、验收）；服务与代理的架构知识归 sandbox-runtime-knowledge
---
# sandbox-runtime 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sandbox-runtime/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7821
- 置信度（confidence）：high
- [JW-SBX-SOFTDELETE-1a] 启用 Windows 软删除时，受保护路径失败必须原地保留
  - 触发：修改 xiaoyi_0.2.4.beta3 JiuwenBox Windows 软删除 hook、broker 或 runner 环境传递。
  - 强制：仅在 Windows 且软删除启用的受保护 hook 路径执行回收/同卷归档；向子进程传递 enabled/archive/DLL/broker port/token。委托 broker 失败保留源文件；移动成功不得随后调用原始删除，失败以拒绝删除状态返回。
  - 验收：在实际 Windows 环境分别验证受保护路径成功回收、broker 拒绝和归档失败；失败源文件仍存在，并检查禁用与跳过路径行为。^[PR #7821]
- [JW-SBX-INJECT-1a] 软删除注入遵守进程类型与位数边界
  - 触发：修改 xiaoyi_0.2.4.beta3 JiuwenBox win_exec 或软删除 CreateProcess hook。
  - 强制：MSYS/Cygwin 镜像不加载该软删除 DLL，通过调试循环在兼容 Windows 后裔 main 前注入；排除 conhost/openconsole；正常目标保持挂起直到成功装入匹配位数 DLL。
  - 验收：实际验证 Git Bash fork、Windows 后裔保护、控制台宿主存活和位数不匹配失败；仅静态检查不得声称这些运行结果通过。^[PR #7821]

## 决策与踩坑

- [JW-SBX-SOFTDELETE-1a] 禁止：把可选用户态 hook 宣称为所有平台/所有删除均覆盖；删除失败后退回永久删除；遗漏显式跳过路径或未支持进程的边界。
- [JW-SBX-INJECT-1a] 禁止：向被排除镜像强行注入；32 位进程装入 64 位 DLL 后继续无保护运行；把源码注释的兼容性解释当成已完成真实 Windows 回归。
