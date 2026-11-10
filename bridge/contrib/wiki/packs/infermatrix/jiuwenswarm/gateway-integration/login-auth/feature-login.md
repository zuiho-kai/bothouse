---
name: feature-login
description: 账号登录与凭据续期 的职责、接口与配置：AuthService 入口符号、JIUWENSWARM_CONFIG_URL 引导的配置入口、设计取舍、数据流与关联功能、验证步骤
metadata:
  scope: 只收职责、接口、配置、取舍、数据流、验证六段概览；实现深读归 feature-depth-login，源码逐文件声明归 login-auth-contracts-01
---
# 账号登录与凭据续期 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/login-auth/feature-login.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/auth/service.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/华为账号登录.md
- 源页字段（feature）：login
- 入口（entry_points）：jiuwenswarm/common/auth/service.py
- 源页字段（source_globs）：jiuwenswarm/common/auth/service.py；jiuwenswarm/common/auth/*.py；jiuwenswarm/extensions/agentos/agentos_router/agentos_authenticator.py；jiuwenswarm/channels/web/frontend/src/services/authClient.ts；jiuwenswarm/common/auth/session_store.py
  - jiuwenswarm/gateway/channel_manager/web/web_http_auth.py；jiuwenswarm/gateway/app_gateway.py；jiuwenswarm/gateway/message_handler/message_handler.py；jiuwenswarm/common/auth/__init__.py；jiuwenswarm/common/auth/account_kit.py；jiuwenswarm/channels/web/hub_oauth.py
  - jiuwenswarm/channels/web/frontend/src/components/AssetPublishDrawer/index.tsx；jiuwenswarm/channels/web/app_web.py；jiuwenswarm/common/auth/login_credentials.py；jiuwenswarm/common/auth/passthrough.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py
  - jiuwenswarm/common/auth/net.py；jiuwenswarm/common/auth/session_owners.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py；jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/OpenAIAccountField.tsx；jiuwenswarm/common/auth/remote_config.py
  - jiuwenswarm/channels/web/frontend/src/stores/authStore.ts；jiuwenswarm/channels/web/frontend/src/components/LoginDialog/LoginDialog.css；jiuwenswarm/channels/web/frontend/src/components/LoginDialog/index.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/models/OpenAIAccountField.css
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 登录链路维护身份、凭据状态和续期，并把可用认证信息交给模型调用。刷新并发、跨进程快照与单次请求身份需要分别定位。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/common/auth/service.py:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L1-L357)；
  - [docs/zh/华为账号登录.md:L1–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L1-L395)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `AuthService [flow, store, enabled, create_authorization_request, complete_callback]`；`get_auth_service()`；`reset_auth_service_for_test(service)`；`ModelAuthRequired`；`live_session(session_id, allow_refresh)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。
  - 参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/common/auth/service.py:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L1-L357)；
  - [docs/zh/华为账号登录.md:L1–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L1-L395)。

### 配置入口与生效条件

- 当前登录通过 JIUWENSWARM_CONFIG_URL 引导远端配置，显式空串或 off 等值关闭该链路；具体默认值沿 remote_config 源码核对。账号是 Huawei Account Kit 身份，凭据换取、回调与模型 APIG 配置由远端信息决定，不能把 IAM 凭据或模型 API Key 当成登录配置。
- 源码与文档：[jiuwenswarm/common/auth/service.py:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L1-L357)；
  - [docs/zh/华为账号登录.md:L1–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L1-L395)。

### 设计取舍

- **设计推断**：授权页、服务器换 token 与本地凭据快照分层处理，让账号模型不需用户填写 API Key；代价是远端引导配置、回调与续期成为可用性条件。文档中的旧默认关闭描述与新版引导默认值存在差异，部署默认行为应以当前源码和有效环境配置核对。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/common/auth/service.py:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L1-L357)；
  - [docs/zh/华为账号登录.md:L1–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L1-L395)。

### 数据流与关联功能

- 登录链路维护身份、凭据状态和续期，并把可用认证信息交给模型调用。刷新并发、跨进程快照与单次请求身份需要分别定位。 联调时结合[[feature-models]]（模型平台与 API 配置）、[[feature-desktop]]（桌面宿主与自动更新）、[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/common/auth/service.py:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L1-L357)；
  - [docs/zh/华为账号登录.md:L1–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L1-L395)。

### 怎样验证

- 检查明确关闭开关时入口与 auth 路由，再验证授权回调、凭据保存与模型请求身份。覆盖过期续期、并发刷新、注销及远端配置不可达，确认跨进程读取到的快照与当前账号一致。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/common/auth/service.py:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/auth/service.py#L1-L357)；
  - [docs/zh/华为账号登录.md:L1–L395](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%8D%8E%E4%B8%BA%E8%B4%A6%E5%8F%B7%E7%99%BB%E5%BD%95.md#L1-L395)。
