---
name: skill-creator-normal-assets-contracts-01
description: skill-creator-normal-assets 源码接口记录 01：skill-creator-normal 的 assets/eval_review.html；覆盖 eval_review.html
metadata:
  scope: 只收 skill-creator-normal-assets 下该源文件的逐文件接口记录；本目录入口归 skill-creator-normal-assets-overview
---
# skill-creator-normal-assets 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/assets/eval_review.html`**
- 源码声明的类型、组件或调用边界：`EVAL_DATA`, `evalItems`, `render`, `tbody`, `sorted`, `lastGroup`, `group`, `headerRow`；这是词法声明索引，不把局部变量当成对外导出 API。
- 页面装配边界：body, link, script 标签；资源装载与宿主连接取决于对应属性和脚本实现。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-creator-normal/assets/eval_review.html#L1-L146)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/skill-creator-normal-assets/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
