---
name: ppt-creation-components-contracts-01
description: ppt-creation-components 源码接口记录 01：ppt-creation 的 components 目录（brand、charts、content、diagrams、index 五个 js 文件）；覆盖 brand.js、charts.js、content.js、diagrams.js、index.js
metadata:
  scope: 只收 ppt-creation-components 下这 5 个源文件的逐文件接口记录；本目录入口归 ppt-creation-components-overview
---
# ppt-creation-components 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/brand.js`**
- 源码声明的类型、组件或调用边界：`C`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const C = require("../scripts/components.js");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/brand.js#L1-L18)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/charts.js`**
- 源码声明的类型、组件或调用边界：`C`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const C = require("../scripts/components.js");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/charts.js#L1-L12)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/content.js`**
- 源码声明的类型、组件或调用边界：`C`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const C = require("../scripts/components.js");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/content.js#L1-L18)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/diagrams.js`**
- 源码声明的类型、组件或调用边界：`C`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`const C = require("../scripts/components.js");`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/diagrams.js#L1-L17)。
- **`jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/index.js`**
- 集成边界的导入/加载声明：`...require("./brand.js"),`；`...require("./charts.js"),`；`...require("./diagrams.js"),`；`...require("./content.js"),`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/ppt-creation/components/index.js#L1-L9)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/ppt-creation-components/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
