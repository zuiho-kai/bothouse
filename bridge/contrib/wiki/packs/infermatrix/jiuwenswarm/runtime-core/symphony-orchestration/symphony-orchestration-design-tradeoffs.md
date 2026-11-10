---
name: symphony-orchestration-design-tradeoffs
description: Symphony 图谱与经验安装的设计取舍：先查图谱再按需构建规划、默认关闭与搜索/构建边界、install_candidate 显式复核入口的收益与代价（均标为设计推断），及 API/配置/验证入口
metadata:
  scope: 收 service.py 与 config.py 相关的三项设计取舍及指向 API、配置、关联功能、验证的入口，来源另含 test_symphony_orchestration_needs_input.py、test_symphony_timeout_lifecycle.py；构建与存储细节归 jiuwenswarm-symphony，规划与候选安装 API 归 jiuwenswarm-symphony-service，演化归 jiuwenswarm-symphony-evolution
---
# Symphony 图谱与经验安装的设计取舍

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/design-tradeoffs.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_symphony_orchestration_needs_input.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_symphony_timeout_lifecycle.py
- 本页解释该组件的设计选择、代价与适用边界。基线为 `f0a69728c96b`。收益和替代方案分析标为**设计推断**，不把推断当成作者历史意图，也不代替规则页。

### 先检查图谱，再按需构建和规划

- plan 先验证 query/mode，再查询图谱状态；需要构建时执行 refresh_graph，并把失败信息带回结果。**设计推断**：规划依赖可复用图谱，而不是每次无条件重建；代价是首次或失效图谱可能让规划经过构建路径，调用方需要区分构建状态与最终规划结果。
- 源码依据：[jiuwenswarm/symphony/service.py:L390–L448](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L390-L448)。

### 默认关闭并给搜索与构建设置边界

- 默认常量分别定义开关、workers、候选数、top_k、max_depth 和置信阈值。**设计推断**：部署可以逐步引入这条能力，并在候选搜索规模与处理工作量之间调节；提高上限不等于提高结果质量，代码中的默认值也不是性能测量结论。具体配置装配与适用字段见现有架构页。
- 源码依据：[jiuwenswarm/symphony/config.py:L12–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L12-L32)。

### 经验候选安装有显式复核入口

- install_candidate 先取得当前 runtime 和 flow，再 review_and_prepare_install；后续检查 preparation.verdict。**设计推断**：经验候选与已安装可执行包分开，安装可围绕指定版本做复核；代价是多一个结果与失败边界，不能把候选生成或 UI 呈现当成已经安装。
- 源码依据：[jiuwenswarm/symphony/service.py:L937–L982](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L937-L982)。

### API、配置与数据流入口

- 图谱配置和装配见[[jiuwenswarm-symphony]]（Symphony 架构），规划与候选安装 API 见[[jiuwenswarm-symphony-service]]（服务入口），演化流程见[[jiuwenswarm-symphony-evolution]]（动态演化）。

### 关联功能

- 图谱来源是技能能力，运行时使用与演化连接 [[agent-runtime-overview]]（Agent Runtime）；配置来自 [[common-core-overview]]（common-core），候选通知由宿主和频道呈现。

### 怎样验证

- [tests/unit_tests/agentserver/test_symphony_orchestration_needs_input.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_symphony_orchestration_needs_input.py#L1-L25)
- [tests/unit_tests/agentserver/test_symphony_timeout_lifecycle.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_symphony_timeout_lifecycle.py#L1-L25)
- 这些入口用于查找既有验证范围；源码阅读没有替代运行测试或真实服务验证。
