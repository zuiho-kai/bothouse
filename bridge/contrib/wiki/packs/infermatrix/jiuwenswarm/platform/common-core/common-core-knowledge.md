---
name: common-core-knowledge
description: 公共契约知识：配置读取与写入的不同边界、AgentServerClient 请求契约、ACP 参数在模块加载时读取、只缓存解析的取舍、chat.final 的 final_mode、配置缓存与并发写入的验证入口
metadata:
  scope: 只收配置缓存、client 契约、ACP 环境参数、final_mode 与验证入口六段知识；config.yaml 读写行为的完整说明归 jiuwenswarm-common-1、jiuwenswarm-common-2，审查规则归 common-core-rules
---
# 公共契约：配置缓存、ACP 设置与最终消息

## 现状

### 配置读取与写入的不同边界

- `get_config()` 先读取 YAML，再在内存中解析环境变量并规范化。解析缓存按路径及 (mtime_ns, size) 识别文件，缓存命中返回深拷贝。`update_config(mutator)` 的 load→mutate→dump 则处于进程内 threading.Lock 与 portalocker 文件锁组成的写临界区，供 Gateway 与 AgentServer 跨进程修改同一配置。
- 来源：[jiuwenswarm/common/config.py:L171–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L171-L244),
  - [jiuwenswarm/common/config.py:L542–L585](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L542-L585)

### AgentServerClient 的请求契约

- 抽象客户端声明 connect、disconnect 和服务端配置快照更新。unary 的 `send_request(envelope, timeout=None)` 返回 AgentResponse；timeout=None 使用客户端默认值，调用者可以显式覆盖超时上限。流式入口 `send_request_stream(envelope)` 返回 AsyncIterator[AgentResponseChunk]；这里是接口契约，具体连接和错误行为由实现提供。
- 来源：[jiuwenswarm/common/client/agent_client.py:L18–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/agent_client.py#L18-L64)

### ACP 参数在模块加载时读取

- ACP stdio 客户端在模块级读取环境变量：ACP_CHAT_TIMEOUT 默认 600 秒，ACP_CHAT_MAX_PARSE_BUFFER_BYTES 默认 24 MiB，ACP_CHAT_STDOUT_READ_CHUNK 默认 65536。ACP_AUTO_APPROVE_PERMISSIONS 默认 true，按 1/true/yes 判定；关闭阶段的等待默认分别为 stdin 4 秒、TERM 5 秒、KILL 8 秒。这些全局常量不会因后续单次配置读取而重新求值。
- 来源：[jiuwenswarm/common/acp/stdio_client.py:L24–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/acp/stdio_client.py#L24-L45)

### 只缓存解析以保留环境热更新

- 配置模块有意只缓存 YAML 解析，环境变量展开和规范化仍在每次 `get_config()` 执行；源码注释把这一选择与运行时 dotenv 更新立即生效联系起来。缓存读写使用深拷贝，避免调用者的原地规范化污染后续读取；写锁不可重入，进程内锁默认等待上限为 10 秒，获取失败抛 TimeoutError；mutator 文档同时注明了嵌套写入的锁争用风险。
- 来源：[jiuwenswarm/common/config.py:L171–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L171-L177),
  - [jiuwenswarm/common/config.py:L199–L228](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L199-L228),
  - [jiuwenswarm/common/config.py:L237–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L237-L244),
  - [jiuwenswarm/common/config.py:L542–L575](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L542-L575)

### chat.final 与前端合并模式

- 最终消息合同定义 patch_segment、replace_turn、append 三种 final_mode。`annotate_chat_final()` 默认补 patch_segment，复制输入后处理；遇到明确的其他 event_type 或已有非空 final_mode 时保留原值。`ensure_final_mode_inplace()` 是原地补齐版本；模块文档将这些显式模式与前端分段覆盖、整轮替换或追加气泡对应。
- 来源：[jiuwenswarm/common/chat_final.py:L3–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/chat_final.py#L3-L47)

### 配置缓存与并发写入的验证入口

- YAML 解析缓存的测试入口为 `tests/unit_tests/common/test_config_parse_cache.py`，并发模型配置写入的入口为 `tests/unit_tests/common/test_config_concurrent_models.py`。它们分开组织读取缓存与写事务的验证；可以分别运行，以定位解析缓存还是配置写入边界发生变化。
- 来源：[tests/unit_tests/common/test_config_parse_cache.py:L1–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_config_parse_cache.py#L1-L13),
  - [tests/unit_tests/common/test_config_concurrent_models.py:L67–L117](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_config_concurrent_models.py#L67-L117)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L171-L244；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L542-L585
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/agent_client.py:L18-L64；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/acp/stdio_client.py:L24-L45
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L171-L177；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L199-L228
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L237-L244；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L542-L575
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/chat_final.py:L3-L47；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_config_parse_cache.py:L1-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_config_concurrent_models.py:L67-L117
