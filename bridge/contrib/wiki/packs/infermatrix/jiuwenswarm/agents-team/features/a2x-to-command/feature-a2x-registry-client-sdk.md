---
name: feature-a2x-registry-client-sdk
description: A2X Registry Client SDK：同步 A2XRegistryClient 与异步 AsyncA2XRegistryClient 的公共入口、构造参数默认值、数据集与 Agent 注册操作、L1 缓存与持久化取舍及假客户端单测
metadata:
  scope: 只收A2X 注册客户端 SDK 的功能概览（接口、默认值、取舍、验证入口）；实现深读归 feature-depth-a2x-registry-client-sdk
---
# A2X Registry Client SDK — 同步/异步镜像式服务注册客户端

## 现状

- **公共入口与生命周期**
- SDK 通过包的 `__init__` 导出两个镜像客户端：`A2XRegistryClient`（同步）与 `AsyncA2XRegistryClient`（异步），并重导出响应数据类（`RegisterResponse`、`PatchResponse`、`Reservation`、`AgentDetail` 等）和以 `A2XError` 为根的异常层级供 `except`/`isinstance` 使用，版本 `0.1.5`。两者均为上下文管理器：同步端 `close()`/`__exit__` 关闭传输层，异步端 `aclose()`/`__aexit__`；
  - HTTP 错误统一映射为 `NotFoundError`（404）、`ValidationError`（400/422，含子类 `UserConfigServiceImmutableError`）、`ServerError`（5xx），网络故障映射为 `A2XConnectionError`；本地所有权检查失败抛 `NotOwnedError`（不发 HTTP 请求）。
- Sources / 来源：[jiuwenswarm/agents/harness/team/a2x/client/__init__.py:L1–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/__init__.py#L1-L60),
  - [jiuwenswarm/agents/harness/team/a2x/client/errors.py:L28–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/errors.py#L28-L73),
  - [jiuwenswarm/agents/harness/team/a2x/client/transport.py:L36–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/transport.py#L36-L60)
- **构造参数与常量默认值**
- 两个客户端构造函数签名一致：`base_url`（默认 `http://127.0.0.1:8000`，经 `normalize_base_url` 补尾部 `/` 以支持挂载点）、`timeout`（默认 30.0 秒）、`api_key`（非空时生成 `Authorization: Bearer <key>` 头）、`ownership_file`（`None` → 默认 `~/.a2x_registry_client/owned.json`，`False` → 禁用持久化，`Path`/`str` → 原样使用）。
  - 其他默认值包括 `create_dataset` 的 `embedding_model="all-MiniLM-L6-v2"` 与 `formats={"a2a": "v0.0"}`（该常量与后端定义刻意重复，因客户端包独立发布不能导入项目其余部分），以及预约租约 `DEFAULT_RESERVATION_TTL=30` 秒。
- Sources / 来源：[jiuwenswarm/agents/harness/team/a2x/client/client.py:L38–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L38-L56),
  - [jiuwenswarm/agents/harness/team/a2x/client/_internal.py:L23–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/_internal.py#L23-L49),
  - [jiuwenswarm/agents/harness/team/a2x/client/_internal.py:L229–L254](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/_internal.py#L229-L254)
- **数据集、Agent 与空白代理池/预约能力**
- 数据集操作只有创建与删除（`create_dataset` POST、`delete_dataset` DELETE），没有更新或列举入口。Agent 侧提供注册（POST `services/a2a`，`persistent=True` 时才记入本地所有权）、PUT 更新/`set_status`、带 AND 语义字段过滤的 `list_agents`、`get_agent`（非 JSON 载荷抛 `UnexpectedServiceTypeError`）与注销。
  - 在此之上构建团队代理流程：`register_blank_agent` 写入以 `description="__BLANK__"` 为发现哨兵、`status=online` 为可用门槛的空白卡片；`reserve_blank_agents` 以 `description=__BLANK__ AND status=online` 作为默认过滤集发起预约（调用方可通过 `extra_filters` 覆盖这两个键，包括 description/status 本身），返回作为上下文管理器的 `Reservation`。
- Sources / 来源：[jiuwenswarm/agents/harness/team/a2x/client/client.py:L99–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L99-L119),
  - [jiuwenswarm/agents/harness/team/a2x/client/client.py:L123–L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L123-L137),
  - [jiuwenswarm/agents/harness/team/a2x/client/client.py:L232–L259](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L232-L259),
  - [jiuwenswarm/agents/harness/team/a2x/client/client.py:L415–L445](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L415-L445)
- **刻意重复的常量、易失的 L1 缓存与尽力而为的持久化**
- `DEFAULT_EMBEDDING_MODEL` 与后端定义刻意重复，因为客户端包独立发布、不能导入项目其余部分——代价是两处必须人工保持同步。`restore_to_blank` 的端点解析采用 L1 内存缓存 → L2 `get_agent` 读当前卡片 → L3 `ValueError` 的三级策略：缓存刻意不持久化，跨进程重启要靠 L2 的额外 GET 兜底。所有权持久化是尽力而为：`_save` 失败被降级为 warning（D8），理由是 HTTP 调用已成功、抛错会诱使调用方重试造成重复注册；
  - 所有权文件按 `base_url` 分段加跨平台文件锁、tmp+`os.replace` 原子重写，损坏文件按首跑友好处理为清空状态。
- Sources / 来源：[jiuwenswarm/agents/harness/team/a2x/client/_internal.py:L26–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/_internal.py#L26-L30),
  - [jiuwenswarm/agents/harness/team/a2x/client/client.py:L388–L411](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/client.py#L388-L411),
  - [jiuwenswarm/agents/harness/team/a2x/client/ownership.py:L1–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/ownership.py#L1-L26),
  - [jiuwenswarm/agents/harness/team/a2x/client/ownership.py:L146–L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/a2x/client/ownership.py#L146-L159)
- **基于假客户端替换的单测**
- `tests/unit_tests/agentserver/test_a2x_client_init.py` 通过 monkeypatch 把 `sys.modules` 中的客户端模块替换为内含 `_FakeAsyncA2XRegistryClient` 的假模块来测试上层适配器对 SDK 的调用方式：断言 teammate 启动时以 `{dataset, endpoint, service_id=None, persistent=True}` 调用 `register_blank_agent` 并关闭客户端，
  - leader 预约路径以 `{dataset, n:1, ttl_seconds:30, holder_id:None, extra_filters:None}` 调用 `reserve_blank_agents` 并在释放后记录 holder。这些测试验证的是传参协议与调用时序，不经过真实 HTTP；destroy 路径还断言卡片替换传入完整空白卡片模板（`_BlankAgent_<endpoint>`/`__BLANK__`/`endpoint`/`online`）且 `release_lease=True`。
- Sources / 来源：[tests/unit_tests/agentserver/test_a2x_client_init.py:L243–L269](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_a2x_client_init.py#L243-L269),
  - [tests/unit_tests/agentserver/test_a2x_client_init.py:L273–L308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_a2x_client_init.py#L273-L308),
  - [tests/unit_tests/agentserver/test_a2x_client_init.py:L348–L375](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_a2x_client_init.py#L348-L375)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-a2x-registry-client-sdk.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/__init__.py:L1-L60；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/errors.py:L28-L73
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/transport.py:L36-L60；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L38-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/_internal.py:L23-L49；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/_internal.py:L229-L254
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L99-L119；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L123-L137
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L232-L259；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L415-L445
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/_internal.py:L26-L30；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/client.py:L388-L411
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/ownership.py:L1-L26；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/a2x/client/ownership.py:L146-L159
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_a2x_client_init.py:L243-L269；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_a2x_client_init.py:L273-L308
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_a2x_client_init.py:L348-L375
- 源页字段（feature）：a2x-registry-client-sdk
- 入口（entry_points）：jiuwenswarm/agents/harness/team/a2x/client/__init__.py；jiuwenswarm/agents/harness/team/a2x/client/async_client.py；jiuwenswarm/agents/harness/team/a2x/client/client.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/team/a2x/client/__init__.py；jiuwenswarm/agents/harness/team/a2x/client/async_client.py；jiuwenswarm/agents/harness/team/a2x/client/client.py；jiuwenswarm/agents/harness/team/a2x/client/_internal.py；jiuwenswarm/agents/harness/team/a2x/client/errors.py
  - jiuwenswarm/agents/harness/team/a2x/client/models.py；jiuwenswarm/agents/harness/team/a2x/client/transport.py；jiuwenswarm/agents/harness/team/a2x/client/ownership.py
