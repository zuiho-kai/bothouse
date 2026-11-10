---
name: debug-overview
description: vLLM-Omni 调试目录入口：什么时候查（仓库专有 bug / crash / 行为异常，读完通用 general/debug/ 后在此做仓库特化路由）、不放通用调试纪律、仓库二次路由表（配置入口 → Configuration，共享模块 → 组件职责地图，单模型 → 模型列表，对齐 / 随机性 / 尺寸 / 风格方法 → debug guides）和停止横向展开的条件
metadata:
  scope: 只收 debug 目录的入口说明和二次路由表；模型输出对齐的方法归 alignment-debug，模型列表入口归 models-overview
---
# vLLM-Omni 调试

## 现状

### 什么时候查这里

- 调查任何 vLLM-Omni 仓库专有 bug、crash 或行为异常。
- 读完通用 `general/debug/` 后必须从这里完成仓库特化路由；不要直接从通用规则跳到源码。

### 不放什么

- 通用调试纪律；先看 `general/debug/`。

### 仓库二次路由

- 先检查仓库 [[vllm-omni-rules-1]]（场景触发器；源锚点 #2-场景触发器）。如果已有一行直接匹配当前任务并链接到 owner，按该链接进入后停止路由，不再打开下面其他候选入口。只有没有直接匹配时才使用本表。

| 下一步要确认什么 | 查看哪里 |
|---|---|
| 配置入口、字段归属、归一化或构造链路 | [[configuration-overview]]（Configuration） |
| 问题属于哪个共享源码模块 | [[components-overview]]（组件职责地图） |
| 问题是否只属于一个模型 | [[models-overview]]（模型列表） |
| 模型对齐、随机性、尺寸或图像风格方法 | debug guides（源链接 `guides/_index.md`） |

- 先用 current main 的入口、调用链和数据 owner 选择一个已有模块或模型，再读该目录的 `_index.md`、`architecture.md` 和已有 `rules.md`，随后停止横向展开。只有调用链证明错误状态由另一个模块制造或跨越边界时才读取第二个模块；文件名、日志词或“可能相关”不构成横向展开理由。现有职责地图覆盖不了时继续查 live 源码；只有复盘证明形成了稳定、可复用的模块边界，才新增模块或更新职责地图。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/debug/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-10
