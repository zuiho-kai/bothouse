---
name: packaging-deploy-overview
description: packaging-deploy 目录入口：打包与部署功能页、冻结入口与容器链路、审查规则 JW-PKG-1a 至 1d，以及 deploy-observability、deploy-yuanrong、scripts 子目录索引
metadata:
  scope: 只收本目录的入口链接与审查规则摘要；功能内容归 feature-deployment、feature-depth-deployment、knowledge-packaging-deploy，规则正文归 packaging-deploy-rules
---
# packaging-deploy

## 现状

- 理解该代码 owner 的职责、接口、配置与相关功能时查这里；通用审查方法不属于本目录。
- [[feature-deployment]]（打包与部署 功能知识）
- [[deploy-observability-overview]]（deploy-observability）
- [[deploy-yuanrong-overview]]（deploy-yuanrong）
- [[packaging-deploy-scripts-overview]]（scripts）
- [[scripts-nfs-overview]]（scripts-nfs）
- [[feature-depth-deployment]]（打包与部署：实现深读）
- [[knowledge-packaging-deploy]]（packaging-deploy：冻结入口、容器与 yuanrong 部署链路）
- [[packaging-deploy-rules]]（packaging-deploy 审查规则） — 解除有兼容性说明的依赖上限前，核对调用方并同步锁文件；分层业务镜像必须保持基础镜像注入与部署身份一致；外部依赖构建参数和可选文件守卫必须分别验证；发行包更名不能连带改写 Python 模块和 CLI 入口。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-09
