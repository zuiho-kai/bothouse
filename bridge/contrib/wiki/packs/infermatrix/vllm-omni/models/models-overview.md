---
name: models-overview
description: vLLM-Omni 模型 owner 入口：模型目录即清单（Get-ChildItem 列目录命令）、怎么选 owner 的四步（PR 有模型名直接进同名目录；名称 / registry key 不确定查 catalog 的 Direct 模型代码入口；找相近实现查 reference models；目录只有 _index 时当源码落脚页）、PersonaPlex 双入口与 MAGI-2 Preview 的指针
metadata:
  scope: 只收模型 owner 的选择方法和入口指针；registry 快照与计数归 models-catalog，参照模型的用途归 reference-models，跨模型共用的不变量入口归 components-overview
---
# 模型 owner

## 现状

<!-- children: filesystem -->

- 模型目录就是清单，不再在本页手工复制几十个目录名。

```powershell
Get-ChildItem knowledge/repos/vllm-omni/models -Directory |
  Select-Object -ExpandProperty Name
```

### 怎么选

1. PR title/body 有明确模型名：直接进入同名目录。
2. 名称、别名或 registry key 不确定：查 [[models-catalog]]（catalog / Direct 模型代码入口；源锚点 #direct-模型代码入口）。
3. 需要找相近实现：查 [[reference-models]]（reference models）。
4. 目录只有 `_index.md` 时，把它当源码落脚页；有 `rules.md` 时优先读规则；只有需要解释完整拓扑时才读 `architecture.md`。
- PersonaPlex 的 staged 与 unified full-duplex 双入口、Mimi 状态和 lockstep 合同见 [[personaplex-overview]]（PersonaPlex owner）。
- 选择一个模型 owner 后停止枚举其他模型。跨模型共用的不变量应进入 [[components-overview]]（components），不要复制到多个模型目录。
- [[magi2-overview]]（MAGI-2 Preview本地BF16routedMoE）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/_index.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-Omni 模型 owner；type: index；tags: vllm-omni, models；created: 2026-07-10；updated: 2026-09-06
