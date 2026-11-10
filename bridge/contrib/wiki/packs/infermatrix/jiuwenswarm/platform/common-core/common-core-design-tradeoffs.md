---
name: common-core-design-tradeoffs
description: 共享配置与模型目录的设计取舍：只缓存 YAML 解析结果、原始配置与运行时视图分开、共享层经 base_crypto 钩子接入扩展（config.py、extensions/registry.py，附验证测试入口）
metadata:
  scope: 只收三项设计取舍及 API/配置入口、关联功能、验证入口的指针；配置读取归 jiuwenswarm-common-1，权限与 MCP 配置面归 jiuwenswarm-common-2，稳定业务 ID 与选择校验归 jiuwenswarm-common-model-catalog
---
# 共享配置与模型目录的设计取舍

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/design-tradeoffs.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/registry.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_config.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_config_concurrent_models.py
- 本页解释该组件的设计选择、代价与适用边界。基线为 `f0a69728c96b`。收益和替代方案分析标为**设计推断**，不把推断当成作者历史意图，也不代替规则页。

### 只缓存 YAML 解析结果

- 源码注释明确将缓存范围止于 YAML 解析，使环境变量变化在后续读取中生效。**设计推断**：这个边界复用解析工作，并保持动态环境覆盖；代价是后续解析和归一化每次仍要执行。缓存身份依赖文件时间与大小，不能据此保证捕获所有保持相同文件标记的改写。
- 源码依据：[jiuwenswarm/common/config.py:L171–L196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L171-L196)。

### 原始配置与运行时视图分开

- get_config_raw 跳过环境变量展开，用于局部读改写回。**设计推断**：持久化层保留占位符，运行时层使用解析后的值，避免写回时固化当前进程环境；相应地，调用方必须明确自己需要哪个视图，不能把解析后的配置当成原始文件无损表示。
- 源码依据：[jiuwenswarm/common/config.py:L262–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L262-L274)。

### 共享层通过钩子接入扩展能力

- crypto bridge 的注释明确 common 不导入扩展框架，而通过 base_crypto 钩子在调用时解析 provider。**设计推断**：这降低共享配置对 Gateway/扩展初始化的耦合；代价是 provider 缺席时的返回与降级行为需要由调用方理解，钩子的存在本身不证明加解密已发生。
- 源码依据：[jiuwenswarm/extensions/registry.py:L33–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/registry.py#L33-L51)。

### API、配置与数据流入口

- 配置、权限和 MCP 的实际 API 与优先级见[[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（公共基础模块）；稳定业务 ID、模型选择和写入校验见[[jiuwenswarm-common-model-catalog]]（模型目录）。

### 关联功能

- 登录模型的凭据生成属于 [[login-auth-overview]]（login-auth），模型目录消费者包括 [[agent-runtime-overview]]（Runtime） 与 [[cron-scheduling-overview]]（Cron）。

### 怎样验证

- [tests/unit_tests/test_config.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_config.py#L1-L25)
- [tests/unit_tests/common/test_config_concurrent_models.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_config_concurrent_models.py#L1-L25)
- 这些入口用于查找既有验证范围；源码阅读没有替代运行测试或真实服务验证。
