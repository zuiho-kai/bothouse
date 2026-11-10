# components

AFD plugin 七个组件 owner：入口、架构与专项规则

- [attention-runtime](attention-runtime/README.md) — Attention 角色运行时：入口、架构、worker 审查规则
- [compatibility](compatibility/README.md) — 上游兼容 patch：入口、架构、规则
- [connectors](connectors/README.md) — connector（CAM async / CAMP2P 等）：入口、架构、review 规则
- [execution-platforms](execution-platforms/README.md) — CUDA/Ascend 执行平台：入口、架构与支持矩阵、平台与硬件 E2E 规则
- [ffn-runtime](ffn-runtime/README.md) — FFN 角色运行时：入口、架构、审查规则
- [model-integration](model-integration/README.md) — 模型集成（模型包装）：入口、架构、评审规则
- [plugin-boundary](plugin-boundary/README.md) — 插件边界：入口、架构、规则
- [components-overview](components-overview.md) — AFD plugin 组件入口总览，含七个知识 owner 的映射表（主源码范围、主要验证）、收录边界和依赖方向
