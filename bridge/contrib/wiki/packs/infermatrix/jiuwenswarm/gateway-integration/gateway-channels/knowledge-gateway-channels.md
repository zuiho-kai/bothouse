---
name: knowledge-gateway-channels
description: Gateway Web 频道处理器 channel_manager/web/app_web_handlers.py：_register_web_handlers 装配、config/models RPC 委托与本地实现、微信数值参数校验、多应用归一化、大附件 E2A 与 HTTP bridge 分流
metadata:
  scope: 只收 Web 频道处理器一个文件的知识卡；进程式 CLI 知识卡归 gateway-channels-knowledge，本目录入口归 gateway-channels-overview
---
# Gateway Web 频道处理器（channel_manager/web/app_web_handlers.py）

## 现状

- **验证入口**
- Inference / 设计推断（非作者历史意图）：
- 本文件源码内未展示针对这些处理器的直接测试。维护者文档称 E2A 聊天流程的验证存在于 `tests/unit_tests/agentserver/test_agentserver_modes.py`、`test_agent_ws_connection_close.py` 与 Gateway `test_agent_client.py`，并在 2026-08-03 记录 114 项生命周期测试通过；这些是文档声明而非本页可核验的运行结果，引用时需按 shown 源码复核。
- Sources / 来源：[.doc_project_maintainer/project/flows/gateway-agentserver-e2a-chat.md:L57–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/.doc_project_maintainer/project/flows/gateway-agentserver-e2a-chat.md#L57-L63),
  - [.doc_project_maintainer/modules/gateway-and-channels/README.md:L36–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/.doc_project_maintainer/modules/gateway-and-channels/README.md#L36-L40)
- **职责与边界：Web RPC 处理器装配**
- 该模块是 WebChannel 的 RPC 处理器与共享常量单一来源，核心入口 `_register_web_handlers(bind)` 通过 `WebHandlersBindParams` 装配 channel、agent_client、message_handler、channel_manager、updater_service 等依赖并注册 Web 前端所需 method。
  - 出站并非只走 message_handler：`_on_connect` 在有 message_handler 时经 `publish_robot_messages` 发 `connection.ack`，否则直接 `channel.send`（L2035–L2039）；`on_disconnect` 清理回调仅在 channel 暴露可调用的 `on_disconnect` 接口时注册（L2050–L2052）。另含 `_DummyBus`，仅满足 Channel 构造所需、不入队不路由（L390–L399）。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1915–L1932](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1915-L1932),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L2035–L2052](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L2035-L2052),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L390–L399](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L390-L399)
- **接口：委托与本地实现并存**
- `_register_web_handlers` 内注册的 RPC 中，`config.get`/`config.set`/`config.save_all` 委托给下沉的 `common.config_panel.config_set_handlers`（L2054–L2058、L2086–L2094），`models.list`/`models.replace_all`/模型校验委托给 `config_panel.models_handlers`（L2104–L2128）。
  - 但并非全部下沉：`_model_resource_rpc` 在本文件内本地实现 `models.get`、`models.references`、`models.delete`、`models.upsert` 等模型资源操作，经 `ModelCatalog`/`upsert_model_resource` 完成并统一用 `channel.send_response` 返回 ok/error/code（L2130–L2169）。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L2054–L2094](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L2054-L2094),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L2104–L2128](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L2104-L2128),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L2130–L2169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L2130-L2169)
- **配置校验与多应用归一化**
- 微信通道四个数值参数在 `channel.wechat.set_conf` 写盘前按 `_WECHAT_NUMERIC_BOUNDS` 校验范围（如 `long_poll_timeout_sec` 须为 1–600 的整数）；`backoff_max_sec` 不得小于 `backoff_base_sec` 的跨字段约束仅在两者同时出现在 params 时才检查（L755–L760、L789–L792）。
  - 飞书/小艺配置由 `_normalize_feishu_conf`/`_normalize_xiaoyi_conf` 统一为 apps 格式并按 `_FEISHU_APP_DEFAULTS`/`_XIAOYI_APP_DEFAULTS` 补齐缺省字段（L1425–L1428、L1499–L1502）；`_merge_apps_by_id` 以已有值为基座、新值覆盖做按 `app_id` 合并——注意归一化已先向新 app 填入默认空值，若前端提交了这些空值字段，仍会覆盖已有的 `app_secret`/`sk`，保护并非无条件成立（L1399–L1404）。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L755–L792](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L755-L792),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1399–L1404](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1399-L1404),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1425–L1428](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1425-L1428),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1499–L1502](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1499-L1502)
- **大附件的传输取舍：预算内走 E2A，超预算按客户端类型分流**
- 转发 media.persist / document.persist 前，Gateway 用 `E2A_PAYLOAD_MAX_BYTES` 减去其余字段的开销算出预算：预算内的 base64 项原样随 E2A 转发；超预算项被解码后上传。
  - 上传路径按 AgentServer 客户端类型分流——AgentOS 路由客户端走 `upload_file_bytes_via_e2a` HTTP bridge，而旧式单用户模式（AgentServer 无 HTTP 上传监听）直接写入共享用户目录 `_persist_media_locally`，落盘路径与 AgentServer 侧 `_store_image_item`/`_store_document_item` 一致，避免注定失败的 HTTP 尝试。
  - 上传失败时保留原 base64 项，只有当它仍超帧限制时才由下游链路返回可重试错误（L1759、L1906 的注释均为条件表述）。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1679–L1692](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1679-L1692),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1822–L1838](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1822-L1838),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1755–L1762](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1755-L1762),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1803–L1812](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L1803-L1812)
- **Web 频道转发方法集与微信参数写盘前校验**
- 该模块定义 `_FORWARD_REQ_METHODS`，把 Web 前端的 RPC method（如 initialize、chat.send、chat.interrupt、session.fork、skills.*、agents.*、schedule.*、proactive.feedback 等）直接转发给 Agent 的 Web method 处理。
  - 另一个已实现功能是微信通道数值参数的写盘前校验：`_validate_wechat_numeric_params` 对 `channel.wechat.set_conf` 中的 `qrcode_poll_interval_sec`、`long_poll_timeout_sec`（须为整数）、`backoff_base_sec`、`backoff_max_sec` 检查有限正数与取值范围（0.1–3600 / 1–600），拒绝 bool 冒充数字；
  - `backoff_max_sec` 不得小于 `backoff_base_sec` 的跨字段约束仅在两个字段同时出现在 params 中时才校验，缺省字段交由默认值处理。校验返回 None 表示合法，非法返回中文错误描述。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L402–L410](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L402-L410),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L752–L793](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L752-L793)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/knowledge-gateway-channels.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:.doc_project_maintainer/project/flows/gateway-agentserver-e2a-chat.md:L57-L63；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:.doc_project_maintainer/modules/gateway-and-channels/README.md:L36-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1915-L1932；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L2035-L2052
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L390-L399；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L2054-L2094
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L2104-L2128；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L2130-L2169
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L755-L792；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1399-L1404
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1425-L1428；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1499-L1502
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1679-L1692；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1822-L1838
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1755-L1762；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L1803-L1812
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L402-L410；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L752-L793
