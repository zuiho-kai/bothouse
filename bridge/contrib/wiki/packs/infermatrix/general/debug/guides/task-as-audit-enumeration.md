---
name: task-as-audit-enumeration
description: 把任务写成审计枚举：outcome task 与 audit task 的区别、常见触发场景对应的最小审计面、五步使用方法
metadata:
  scope: 只收“任务清单按必须检查的面来枚举”这一方法（触发场景、最小审计面、写法）；结论纪律归 conclusion-discipline，复盘转规则归 retrospective-to-rules
---
# 把任务写成审计枚举

## 现状

- 任务清单应该描述“必须检查哪些面”，而不只是重复“已经知道要修什么”。
- 如果 task 只来自第一轮 review 的 action list，它会完整继承那次 review 的盲区。
- 什么时候用：
  - API、配置名或枚举发生变化；
  - producer 新增字段或数据结构；
  - feature branch 合并主分支；
  - 子 agent 或 reviewer 返回一组修改建议；
  - 用户要求“完整检查”“所有位置”或“不要漏”。

## 关键事实

- 源页：`knowledge/general/debug/guides/task-as-audit-enumeration.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, debug；created: 2026-07-10；updated: 2026-07-10；sources: 无

### Outcome task 和 audit task

- Outcome task 只记录已知答案：

```text
替换这个旧名字
删除这一处重复赋值
修复 reviewer 指出的三个位置
```

- Audit task 强制枚举未知范围：

```text
全仓搜索旧名字、别名、配置和测试中的所有组合
从每个 producer 写入点追到所有 consumer 读取点
枚举分支双方都修改过的文件并逐个审查冲突语义
独立重建审查面，再核对 reviewer action list 是否覆盖完整
```

### 常见触发与最小审计面

| 触发场景 | 必须枚举 |
|---|---|
| API rename 或 enum 拆分 | source、tests、examples、config、docs、兼容入口和旧名字组合 |
| producer 新增字段 | 创建、序列化、传输、转换、消费、默认值和异常路径 |
| 合并主分支 | 双方都修改的文件、手工冲突、测试和公开行为 |
| reviewer 或子 agent 给 action list | 原始 diff、未覆盖 owner、边界情况和公开 surface |
| 批量迁移 | 所有输入变体、生成物、索引、链接和回滚路径 |

### 使用方法

1. 在还不知道最终答案前建立 audit task。
2. 每个 task 对应一个可枚举的集合或一条端到端链路。
3. 写清完成证据，例如搜索结果、文件清单、调用链或测试矩阵。
4. action item 可以挂在 audit task 下，但不能替代 audit task。
5. 收尾时说明哪些集合已经完整枚举，哪些仍受权限、环境或信息限制。

## 决策与踩坑

- 目标不是制造更多任务，而是让遗漏变得可见。
