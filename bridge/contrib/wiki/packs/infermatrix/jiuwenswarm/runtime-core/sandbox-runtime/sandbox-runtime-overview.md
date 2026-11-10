---
name: sandbox-runtime-overview
description: sandbox-runtime 目录导航：JiuwenBox 隔离执行与推理隐私代理的功能知识页、实现深读页，代码快速入口表（inference_privacy_proxy.py、inference_privacy_proxy_manager.py、server/app.py）及 knowledge、rules 页链接
metadata:
  scope: 只收目录导览和代码快速入口表；服务与代理的综合知识归 sandbox-runtime-knowledge，Windows 软删除审查规则归 sandbox-runtime-rules，功能知识归 feature-sandbox、feature-sandbox-privacy-proxy，实现深读归 feature-depth-sandbox、feature-depth-sandbox-privacy-proxy
---
# sandbox-runtime

## 现状

- 理解该代码 owner 的职责、接口、配置与相关功能时查这里；通用审查方法不属于本目录。
- [[feature-sandbox]]（JiuwenBox 隔离执行 功能知识）
- [[feature-sandbox-privacy-proxy]]（JiuwenBox 推理隐私代理功能知识）
- [[feature-depth-sandbox]]（JiuwenBox 隔离执行：实现深读）
- [[feature-depth-sandbox-privacy-proxy]]（JiuwenBox 推理隐私代理：实现深读）

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：sandbox runtime。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| sandbox runtime | 入口 | `jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy.py`、`jiuwenbox/src/jiuwenbox/proxy/inference_privacy_proxy_manager.py`、`jiuwenbox/src/jiuwenbox/server/app.py` |

- [[sandbox-runtime-knowledge]]（sandbox-runtime（JiuwenBox 服务与推理隐私代理））
- [[sandbox-runtime-rules]]（sandbox-runtime 审查规则） — 启用 Windows 软删除时，受保护路径失败必须原地保留；软删除注入遵守进程类型与位数边界。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/sandbox-runtime/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-09
