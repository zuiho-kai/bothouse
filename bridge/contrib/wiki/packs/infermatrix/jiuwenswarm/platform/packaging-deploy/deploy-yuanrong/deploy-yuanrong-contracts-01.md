---
name: deploy-yuanrong-contracts-01
description: deploy/yuanrong 下 args_handler.sh、deploy.sh 等 shell 脚本的源码接口与集成边界（source 加载声明）
metadata:
  scope: 只收 deploy/yuanrong 的静态接口记录；目录入口归 deploy-yuanrong-overview，部署链路说明归 knowledge-packaging-deploy
---
# deploy-yuanrong 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`deploy/yuanrong/args_handler.sh`**
- 源码声明的类型、组件或调用边界：`on`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/deploy/yuanrong/args_handler.sh#L1-L84)。
- **`deploy/yuanrong/deploy.sh`**
- 集成边界的导入/加载声明：`source "global_vars.sh"`；`source "common.sh"`；`source "cmd_handler.sh"`；`source "args_handler.sh"`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/deploy/yuanrong/deploy.sh#L1-L67)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/deploy-yuanrong/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
