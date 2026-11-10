---
name: feature-depth-skill-hub
description: Skill Hub 实现深读：HubClient.get_plugin 精确查询与 HubPage.from_payload、默认地址 swarmskills.openjiuwen.com 与 60 秒超时、HttpHubTransport 404 与 retry_after、发布超时 outcome_unknown
metadata:
  scope: 只收 hub_client、hub_models 与发布客户端的实现级事实；职责与配置概览归 feature-skill-hub
---
# Skill Hub 与市场流通：实现深读

## 现状

- [[feature-skill-hub]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **get_plugin 到 HubPage.from_payload 的解析链** HubClient.get_plugin 以 asset_id 为输入：清洗参数后通过 HubTransport.get_data 请求 /api/v1/plugins，把返回 payload 交给 HubPage.from_payload 解析；解析得到的分页对象再由调用方按 asset_id 精确匹配，命中则返回 HubCatalogItem，未命中抛 HubNotFoundError。
- 调用路径：`jiuwenswarm/server/runtime/marketplace/hub_client.py`（`HubClient.get_plugin`） → `jiuwenswarm/server/runtime/marketplace/hub_models.py`（`HubPage.from_payload`）
- 来源：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L220–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L220-L245),
  - [jiuwenswarm/server/runtime/marketplace/hub_models.py:L163–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_models.py#L163-L177)
- **HubClient.get_plugin 的精确查询契约** 调用方必须传入非空 asset_id（空白即抛 ValueError("asset_id is required")）。方法按 asset_id（可选 plugin_type）过滤首页结果并返回 asset_id 完全相等的 HubCatalogItem；页面中没有匹配项时抛 HubNotFoundError，payload 非法时抛 HubProtocolError。
- 来源：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L220–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L220-L245)
- **Hub 默认地址与不安全 HTTP 开关** 默认 Hub 地址为 DEFAULT_HUB_BASE_URL = "https://swarmskills.openjiuwen.com"，默认超时 60.0 秒。环境变量 TEAM_SKILLS_HUB_ALLOW_INSECURE_HTTP 默认关闭，仅当值（去空白并小写后）属于 {"1","true","yes","on","enabled"} 时 _allow_insecure_http 才返回真。
- 来源：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L45–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L45-L54)
- **读路径不阻塞换来的代价是冷启动与分页期间数据不完整** 设计推断（非作者历史意图）：
- 选择：读取不等刷新完成，loader 在后台任务中分页拉取，read 立即返回旧快照或 miss。收益：测试中上游 post 被 gate 阻塞时，handle_skills_swarm_skills_hub_recommend 仍在 asyncio.wait_for 的 0.05 秒内返回 state='miss'，调用方不被慢 Hub 请求卡住。代价：冷启动首个请求拿到空列表（not items 且 state['refreshing']），分页全部完成前只能看到部分条目（len(items)==2 且 has_more 为真）。该取舍为基于所引测试行为的推断，非文档记载的历史意图。
- 来源：[tests/test_hub_catalog_cache.py:L76–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/test_hub_catalog_cache.py#L76-L84),
  - [tests/test_hub_catalog_cache.py:L275–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/test_hub_catalog_cache.py#L275-L281)
- **hub_publish_client 模块级导入 hub_client 与 hub_publish_port；hub_client 仅在 publish() 的 _publisher 为空分支内按需导入 HubPublishClient** hub_publish_client.py 在模块级从 hub_client 导入 HttpHubTransport、从 hub_publish_port 导入 parse_publish_result（L26–L27）。
  - HubClient.publish 仅在 self._publisher is None 分支内才在函数体导入 HubPublishClient 并以 base_url=self.base_url 构造（L178–L183），之后复用该实例（L184），把这次耦合推迟到首次 publish。
- 来源：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L176–L184](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L176-L184),
  - [jiuwenswarm/server/runtime/marketplace/hub_publish_client.py:L26–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_publish_client.py#L26-L27)
- **HttpHubTransport.get_data：404 抛 HubNotFoundError，其余非成功状态抛携带 status_code/retry_after 的 HubProtocolError** get_data（L108–L147，函数完整可见）在请求未抛异常后检查状态：response.status_code == 404 时抛 HubNotFoundError("SkillHub 资源不存在")（L125–L126）；
  - not response.is_success 时抛 HubProtocolError 并设置 error.status_code 与取自 Retry-After 响应头的 error.retry_after（L127–L131）。异常直接上抛，函数内无重试。
- 来源：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L108–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L108-L147)
- **发布超时 outcome_unknown 的 MockTransport 运行时测试** test_http_request_timeout_is_uncertain 用 httpx.MockTransport 处理器返回 408，断言 HubPublishClient(...).publish(draft, auth=PublishAuth("secret")) 抛 PublishUploadError 且 exc.value.outcome_unknown 为真。
- 来源：[tests/unit_tests/server/marketplace/test_hub_publish_client.py:L366–L375](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/server/marketplace/test_hub_publish_client.py#L366-L375)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-skill-hub.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/marketplace/hub_client.py:L220-L245；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/marketplace/hub_client.py:L45-L54
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/marketplace/hub_models.py:L163-L177；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/test_hub_catalog_cache.py:L76-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/test_hub_catalog_cache.py:L275-L281；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/server/marketplace/test_hub_publish_client.py:L366-L375
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/marketplace/hub_client.py:L176-L184；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/marketplace/hub_publish_client.py:L26-L27
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/marketplace/hub_client.py:L108-L147
- 源页字段（feature）：skill-hub
- 入口（entry_points）：jiuwenswarm/server/runtime/marketplace/hub_client.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/marketplace/hub_client.py；jiuwenswarm/server/runtime/marketplace/*
