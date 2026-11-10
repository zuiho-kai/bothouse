---
name: feature-skill-hub
description: Skill Hub 与市场流通功能概览：HubClient、HttpHubTransport、环境变量 TEAM_SKILLS_HUB_BASE_URL / TEAM_SKILLS_HUB_TIMEOUT / TEAM_SKILLS_HUB_ALLOW_INSECURE_HTTP、验证步骤
metadata:
  scope: 只收 Skill Hub 的职责、接口入口、配置入口、设计取舍与验证方法（guide）；get_plugin 解析链、默认地址与超时、发布超时测试归 feature-depth-skill-hub；本地技能安装与发现归 feature-skills
---
# Skill Hub 与市场流通 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-skill-hub.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/marketplace/hub_client.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/技能.md
- 源页字段（feature）：skill-hub
- 入口（entry_points）：jiuwenswarm/server/runtime/marketplace/hub_client.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/marketplace/hub_client.py；jiuwenswarm/server/runtime/marketplace/*；jiuwenswarm/channels/web/frontend/src/hooks/useAssetPublication.ts；jiuwenswarm/channels/web/frontend/src/components/AssetPublishDrawer/index.tsx
  - jiuwenswarm/channels/web/frontend/src/components/AssetPublishDrawer/style.css；jiuwenswarm/channels/web/frontend/src/services/assetPublishApi.ts；jiuwenswarm/server/runtime/skill/skill_manager.py；jiuwenswarm/channels/web/frontend/src/features/ClawHubSearchModal/index.tsx
  - jiuwenswarm/channels/web/frontend/src/features/SourceManagerModal/index.tsx；jiuwenswarm/server/runtime/marketplace/hub_asset_installer.py；jiuwenswarm/server/runtime/marketplace/hub_asset_port.py；jiuwenswarm/server/runtime/marketplace/asset_publish_api.py
  - jiuwenswarm/server/runtime/marketplace/asset_publish_models.py；jiuwenswarm/server/runtime/marketplace/asset_publish_service.py；jiuwenswarm/server/runtime/marketplace/asset_publish_store.py；jiuwenswarm/server/runtime/marketplace/hub_asset_type_adapter.py
  - jiuwenswarm/server/runtime/marketplace/hub_avatar_cache.py；jiuwenswarm/server/runtime/marketplace/hub_catalog_cache.py；jiuwenswarm/server/runtime/marketplace/hub_install_state.py；jiuwenswarm/server/runtime/marketplace/hub_package_downloader.py
  - jiuwenswarm/server/runtime/marketplace/hub_publish_client.py；jiuwenswarm/server/runtime/marketplace/hub_publish_port.py；jiuwenswarm/channels/web/frontend/src/components/marketplace/CatalogCacheNotice.tsx
  - jiuwenswarm/channels/web/frontend/src/components/marketplace/InstallationFilterSelect.tsx；jiuwenswarm/channels/web/frontend/src/components/marketplace/MarketplaceSurface.tsx；jiuwenswarm/channels/web/frontend/src/components/marketplace/PublicationDetailStatus.tsx
  - jiuwenswarm/server/runtime/marketplace/asset_package_builder.py；jiuwenswarm/channels/web/frontend/src/features/OnlineSkillSearchPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/components/SkillPanel/useHubMarketplace.ts
  - jiuwenswarm/channels/web/frontend/src/components/SkillPanel/MarketplaceView.tsx；jiuwenswarm/channels/web/frontend/src/utils/gitcodeOAuth.ts；jiuwenswarm/server/runtime/marketplace/asset_publish_adapters.py
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/teamskills.ts；jiuwenswarm/channels/web/frontend/src/features/TeamSkillsHubModal/index.tsx
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 市场入口管理能力资产的查询、发布和安装相关状态。远端资产信息、下载结果和本地已安装状态是不同事实，需要逐阶段确认。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L1–L370](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L1-L370)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `HubProtocolError`；`HubNotFoundError`；`HubTransport [get_data]`；`HttpHubTransport [get_data]`；`HubClient [publish, list_plugins, get_plugin, get_version, get_artifact]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L1–L370](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L1-L370)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 配置入口与生效条件

- 实现中直接读取的环境变量名称包括 `TEAM_SKILLS_HUB_ALLOW_INSECURE_HTTP`、`TEAM_SKILLS_HUB_BASE_URL`、`TEAM_SKILLS_HUB_TIMEOUT`；名称与实际部署值分开核对。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L1–L370](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L1-L370)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 设计取舍

- **设计推断**：远端市场提供能力发现和分发，降低本地维护目录的成本；代价是源管理、网络读取、下载内容与本地安装状态需要分别校验。远端显示可用不表示本地已安装，安装成功也不表示当前 Agent 已重新发现技能。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L1–L370](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L1-L370)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 数据流与关联功能

- 市场入口管理能力资产的查询、发布和安装相关状态。远端资产信息、下载结果和本地已安装状态是不同事实，需要逐阶段确认。 联调时结合[[feature-skills]]（技能安装、挂载与发现）、[[feature-symphony]]（Symphony 检索与图谱编排）、[[feature-applications]]（Application Plugin 与前端贡献）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L1–L370](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L1-L370)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。

### 怎样验证

- 配置一个可读技能源，执行检索、查看详情与安装并核对本地文件。覆盖源不可达、无效包与重复安装，检查源信息更新和本地禁用、卸载不会误报为已加载能力。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/marketplace/hub_client.py:L1–L370](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/marketplace/hub_client.py#L1-L370)；
  - [docs/zh/技能.md:L1–L632](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%8A%80%E8%83%BD.md#L1-L632)。
