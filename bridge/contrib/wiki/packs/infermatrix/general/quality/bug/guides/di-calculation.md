---
name: di-calculation
description: DI 计算说明：按 Bug 优先级给出基础 DI（Defect Intensity）与 SLO 的分级表、偶现降级、按 SLO 累加的示例与通式
metadata:
  scope: 只收 Bug 定级与 DI / SLO 的统一计算口径；某个仓库专属的缺陷跟踪字段、看板流程和具体 issue 的调查结论不收
---
# DI 计算说明

## 现状

- 按 Bug 优先级给出基础 DI（Defect Intensity）与 SLO，并说明偶现降级与按 SLO 累加的计算方式。
- 相关入口：[[bug-overview]]（bug 主题）、[[debug-overview]]（调试）、[[ci-overview]]（测试与 CI）。

## 关键事实

- 源页：`knowledge/general/bug/guides/di-calculation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, bug；created: 2026-08-07；updated: 2026-09-22；sources: 无

### Bug 分级标准

| Bug 优先级分类 | 划分标准 | DI 值 | SLO |
|---|---|---|---|
| critical | 高优先级 | 10 | 1 天 |
| high priority | CI Failure | 3 | 5 天 |
| medium priority | 中优先级 | 1 | 10 天 |
| low priority | 低优先级 | 0.1 | 14 天 |
| invalid | 非问题 | 0 | / |

### 其他规则

1. **偶现降级**：若为偶现问题，分类等级自动降低一级。
2. **按 SLO 累加**：每达到一次 SLO，DI 值累加一次。

### 累加示例

- critical 等级 bug（基础 DI = 10，SLO = 1 天）：

| 未关闭天数 | 达到的 SLO 次数 | DI |
|---|---|---|
| 第 1 天 | 1 | 10 |
| 第 2 天 | 2 | 20 |
| 第 3 天 | 3 | 30 |

- 通式：`DI = 基础 DI × ⌈未关闭天数 / SLO 天数⌉`（`invalid` 始终为 0）。
