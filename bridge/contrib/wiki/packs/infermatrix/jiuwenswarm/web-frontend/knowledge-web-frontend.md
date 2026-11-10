---
name: knowledge-web-frontend
description: Web 静态入口知识：app_web.py 对 frontend/dist 的静态产物与 /api、/ws 代理边界、GET /file-api/list-files 的 400/403 契约、JIUWENSWARM_DATA_DIR 工作区优先级、哈希资产 immutable 缓存取舍、POST /share-api/jobs 与桌面认证、缓存头测试入口
metadata:
  scope: 收 app_web.py 一带的静态入口、接口、配置、取舍、分享任务与缓存测试六项知识，来源另含 desktop-electron-packaging.md、test_web_static_cache_headers.py；逐文件接口声明归 web-frontend-contracts-01，配额导航审查规则归 web-frontend-rules
---
# Web 静态入口：产物、接口、配置与验证

## 现状

### 包内静态产物与代理边界

- 静态产物统一来自代码包内的 `frontend/dist`。该入口同时接管路径前缀 `/api` 和 `/ws`：前者进入 HTTP 代理，后者仅在 WebSocket upgrade 成立时建立隧道，否则返回 400。
- 来源：[jiuwenswarm/channels/web/app_web.py:L185–L203](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L185-L203),
  - [jiuwenswarm/channels/web/app_web.py:L506–L521](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L506-L521),
  - [jiuwenswarm/channels/web/app_web.py:L965–L975](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L965-L975)

### 文件列表的输入与错误返回

- 非 AgentOS 路由下，`GET /file-api/list-files` 接收 `dir` 参数：缺少参数返回 400，解析后的目录越出允许根返回 403，目录不存在或不是目录时返回 200 与空 `files`。成功结果按目录在前、名称在后排序，每项包含 name、path、isMarkdown、isDirectory。
- 来源：[jiuwenswarm/channels/web/app_web.py:L1257–L1274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L1257-L1274),
  - [jiuwenswarm/channels/web/app_web.py:L1300–L1327](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L1300-L1327)

### 工作区优先级与处理器默认值

- `JIUWENSWARM_DATA_DIR` 非空时直接作为工作区；否则在 `JIUWENSWARM_HOME`（未设置时为用户 home）下追加 `.jiuwenswarm`。处理器的 `api_target`、`ws_target` 默认空字符串，`ws_disable_compress` 默认 False；桌面模式的 `desktop_token` 默认也为空，仅保护 SPA 文档入口的锁在源码 Web 模式下未设置。
- 来源：[jiuwenswarm/channels/web/app_web.py:L82–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L82-L100),
  - [jiuwenswarm/channels/web/app_web.py:L303–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L303-L314)

### 避免前后端版本错配与缓存取舍

- 实现注释明确拒绝加载用户数据目录中的旧 dist，以避免升级后后端与前端静默错配。Vite 哈希资产采用一年 immutable 缓存，index.html 与 SPA fallback 则回源验证：带哈希的资源复用缓存，入口引用仍能随升级更新。这是代码与桌面打包文档记录的取舍，不据此推断其他历史动机。
- 来源：[jiuwenswarm/channels/web/app_web.py:L185–L203](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L185-L203),
  - [jiuwenswarm/channels/web/app_web.py:L2067–L2078](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L2067-L2078),
  - [docs/zh/desktop-electron-packaging.md:L101–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L101-L108)

### 分享任务与桌面认证的关系

- 非 AgentOS 路由下，`POST /share-api/jobs` 需要非空 session_id，正文超过 64KB 返回 413；同会话存在活跃任务时直接复用，否则创建导出任务。桌面模式的独立 Playwright BrowserContext 不共享 WebView Cookie，入口将当前实例的 cookie 名和 token 传给渲染器；普通 Web 模式下不构造该认证信息。
- 来源：[jiuwenswarm/channels/web/app_web.py:L1191–L1222](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L1191-L1222),
  - [jiuwenswarm/channels/web/app_web.py:L1234–L1255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L1234-L1255)

### 缓存合同的测试入口

- `tests/unit_tests/channels/web/test_web_static_cache_headers.py` 使用 HTTP 请求断言哈希资产的 immutable 头、根路径与 SPA fallback 的 no-cache 头，以及条件请求返回 304 时仍保留 immutable 头。桌面打包文档也指向此测试。运行入口为 `pytest tests/unit_tests/channels/web/test_web_static_cache_headers.py`；这些断言描述该缓存合同的验证范围。
- 来源：[tests/unit_tests/channels/web/test_web_static_cache_headers.py:L63–L105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/web/test_web_static_cache_headers.py#L63-L105),
  - [docs/zh/desktop-electron-packaging.md:L101–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L101-L108)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/knowledge-web-frontend.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L185-L203；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L506-L521
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L965-L975；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L1257-L1274
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L1300-L1327；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L82-L100
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L303-L314；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L2067-L2078
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/desktop-electron-packaging.md:L101-L108；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L1191-L1222
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L1234-L1255；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/web/test_web_static_cache_headers.py:L63-L105
