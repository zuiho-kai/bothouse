---
name: jiuwenbox-src-rules
description: "jiuwenbox-src 审查规则 JW-JBX-DLL-1a：原生 DLL 须进入 package-data native/*.dll、x64 工具链缺 cl.exe 即失败、忽略 pdb/lib/exp/obj 中间产物；来源 PR #7821"
metadata:
  scope: 只收规则 JW-JBX-DLL-1a 一条；逐文件接口记录归 jiuwenbox-src-contracts-01 至 jiuwenbox-src-contracts-03
---
# jiuwenbox-src 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/subpackages/jiuwenbox-src/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7821
- 置信度（confidence）：high
- [JW-JBX-DLL-1a] 原生 DLL 进入包数据，构建中间产物留在仓库外
  - 触发：修改 jiuwenbox 原生 DLL、其构建脚本或 pyproject package-data。
  - 强制：将分发 DLL 匹配到 package-data 的 native/*.dll；构建使用与目标一致的 x64 工具链，缺 cl.exe 明确失败；忽略并清理 pdb/lib/exp/obj 等中间产物。
  - 验收：检查构建工具链和输出 PE 架构；实际 wheel 中包含分发 DLL，受跟踪文件中无新增中间产物。^[PR #7821]

## 决策与踩坑

- [JW-JBX-DLL-1a] 禁止：只在源码目录放 DLL 而遗漏 wheel 包数据；提交链接中间产物；仅凭脚本提示 x64 就宣称工具链位数已经验证。
