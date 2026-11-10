---
name: feature-sandbox-privacy-proxy
description: JiuwenBox 推理隐私代理功能知识：全局代理 host:port 与 path_prefix 路由、/api/v1/proxy/* REST、inference_privacy_proxies 配置键、proxy-only policy、密钥服务端注入的取舍与验证步骤
metadata:
  scope: 只收推理隐私代理的功能入口级知识；隔离执行归 feature-sandbox，代理的逐点实现深读归 feature-depth-sandbox-privacy-proxy
---
# JiuwenBox 推理隐私代理的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sandbox-runtime/feature-sandbox-privacy-proxy.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenbox/README_CN.md
- 源页字段（feature）：sandbox-privacy-proxy
- 入口（entry_points）：jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py；jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py
- 源页字段（source_globs）：jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py；jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py；jiuwenbox/src/jiuwenbox/proxy/__init__.py；jiuwenbox/src/jiuwenbox/server/app.py；jiuwenbox/src/jiuwenbox/server/policy_reader.py
  - jiuwenbox/src/jiuwenbox/server/proxy_manager.py；jiuwenbox/src/jiuwenbox/server/routes/proxy.py
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- JiuwenBox 全局推理代理监听一个 host:port，以 path_prefix 选择路由并改写转发路径和认证头，每条路由独立启停。proxy-only policy 可跳过沙箱子系统，health 和代理仍可用，而 sandbox 与 policy API 返回服务不可用；代理就绪不说明隔离执行已经启用。
- 源码与文档：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L1–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L1-L477)；
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L1–L664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L1-L664)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 接口与调用入口（API）

- InferencePrivacyProxy 提供路由匹配、路径改写、认证注入、enable_route、disable_route、start 与 stop 等内部边界；manager 管理创建、更新和删除状态，REST 位于 /api/v1/proxy/*。对外请求路径包含路由前缀，转发时匹配目标端点并移除该前缀。
- 源码与文档：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L1–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L1-L477)；
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L1–L664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L1-L664)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 配置入口与生效条件

- inference_privacy_proxies 声明 listen_host、listen_port 与 routes，port=0 默认禁用。每条 route 包含 path_prefix、target_endpoint、api_key 及 skip_cert_verify；有效 host 和非零 port 是 API 创建路由的前置条件。proxy-only 顶层 policy 只允许 version、name 与代理配置，添加沙箱字段才会初始化沙箱子系统。
- 源码与文档：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L1–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L1-L477)；
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L1–L664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L1-L664)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 设计取舍

- **设计推断**：代理把真实密钥留在服务端并按路由注入，减少工具进程直接持有 provider 凭据的需要；代价是路由、监听权限与认证头处理成为关键边界。proxy-only 降低单独部署代理的依赖，但其成功健康响应不能被当成沙箱能力的健康证明。
- 源码与文档：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L1–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L1-L477)；
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L1–L664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L1-L664)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 数据流与关联功能

- 客户端请求路由前缀后，代理选择目标并重写 API 路径，按 OpenAI 或 Anthropic 格式注入认证，再转发流量。路由启停与代理监听状态分开管理；与模型配置和沙箱网络策略联调时应检查真实目标、请求身份和沙箱可达性。
- 源码与文档：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L1–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L1-L477)；
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L1–L664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L1-L664)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。

### 怎样验证

- 用本地模拟 provider 验证路径改写和 OpenAI、Anthropic 认证头注入，检查停用、未知路由和热更新。分别启动完整 policy 与 proxy-only，核对 health、代理和沙箱 API 的边界，再覆盖端口冲突与上游连接错误。本页没有执行上游测试。
- 源码与文档：[jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py:L1–L477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py#L1-L477)；
  - [jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py:L1–L664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py#L1-L664)；
  - [jiuwenbox/README_CN.md:L1–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenbox/README_CN.md#L1-L903)。
