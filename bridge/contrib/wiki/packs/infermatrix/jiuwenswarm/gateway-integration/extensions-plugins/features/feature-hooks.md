---
name: feature-hooks
description: 生命周期 Hooks 与扩展功能知识入口：职责与边界、ExtensionManager 接口入口、registry 构造参数、设计取舍、关联功能与验收步骤
metadata:
  scope: 只收生命周期扩展的功能概览与六个 facet 摘要；ExtensionManager 加载与关闭的实现证据归 feature-depth-hooks
---
# 生命周期 Hooks 与扩展 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-hooks.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Harness.md
- 源页字段（feature）：hooks
- 入口（entry_points）：jiuwenswarm/extensions/manager.py
- 源页字段（source_globs）：jiuwenswarm/extensions/manager.py；jiuwenswarm/extensions/*.py；jiuwenswarm/extensions/callback_compat.py；jiuwenswarm/extensions/loader.py；jiuwenswarm/extensions/registry.py；jiuwenswarm/extensions/sdk/agent_server_client.py；jiuwenswarm/extensions/sdk/base.py
  - jiuwenswarm/extensions/sdk/crypto_utility.py；jiuwenswarm/extensions/sdk/third_agent.py；jiuwenswarm/extensions/types.py；jiuwenswarm/extensions/sdk/__init__.py；jiuwenswarm/extensions/__init__.py；jiuwenswarm/gateway/message_handler/message_handler.py
  - jiuwenswarm/extensions/hook_event.py；jiuwenswarm/extensions/hooks_context.py；jiuwenswarm/gateway/hooks/handler.py；jiuwenswarm/server/hooks/executor.py；jiuwenswarm/common/hooks_config.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py
  - jiuwenswarm/server/hooks/user_hook_rail.py；jiuwenswarm/channels/web/frontend/src/App.tsx
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 生命周期扩展在既有执行边界插入处理逻辑。Hook 事件、上下文与回调兼容层分担职责，启用一个扩展并不意味着所有宿主都提供相同事件。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/extensions/manager.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L1-L125)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `ExtensionManager [load_all_extensions, shutdown_all_extensions, list_extensions]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/extensions/manager.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L1-L125)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 配置入口与生效条件

- 该源码入口的构造或调用参数包括 `registry`；它们是调用参数，不自动等同于全仓持久配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/extensions/manager.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L1-L125)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 设计取舍

- **设计推断**：生命周期 Hook 让扩展在模型、工具与运行结束等边界加入处理，减少直接修改 Agent 循环；代价是事件上下文、回调签名和宿主兼容性需要协调。不同宿主提供的事件可能不同，单个 Hook 的启用不能代表所有执行路径都已接入。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/extensions/manager.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L1-L125)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 数据流与关联功能

- 生命周期扩展在既有执行边界插入处理逻辑。Hook 事件、上下文与回调兼容层分担职责，启用一个扩展并不意味着所有宿主都提供相同事件。 联调时结合[[feature-harness]]（Agent Loop 与 Rail 装配）、[[feature-applications]]（Application Plugin 与前端贡献）、[[feature-observability]]（执行轨迹与保留）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/extensions/manager.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L1-L125)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 怎样验证

- 注册最小扩展记录一轮模型与工具事件，核对触发顺序、上下文身份和取消后的收尾。覆盖回调失败、扩展禁用与重复装载，检查兼容接口是否只在对应宿主路径调用。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/extensions/manager.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L1-L125)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。
