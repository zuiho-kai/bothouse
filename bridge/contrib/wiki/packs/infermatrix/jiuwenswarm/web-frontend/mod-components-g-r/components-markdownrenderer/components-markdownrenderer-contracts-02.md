---
name: components-markdownrenderer-contracts-02
description: components-markdownrenderer 源码接口与集成边界 02：web/frontend/src/components 下 MarkdownRenderer/markdownPlugins.ts、MarkdownRenderer/markdownTransforms.ts、MarkdownRenderer/math/remarkLatexDelimiters.ts 共 3 个前端文件的静态声明（类型、组件与导入边界）
metadata:
  scope: 只收上列 3 个前端文件的静态声明，不证明运行行为；其余前端文件的声明归 components-markdownrenderer-contracts-01；入口说明归 components-markdownrenderer-overview
---
# components-markdownrenderer 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/markdownPlugins.ts`**
- 源码声明的类型、组件或调用边界：`KATEX_OPTIONS`, `KATEX_HTML_ONLY_OPTIONS`, `MARKDOWN_REMARK_PLUGINS`, `MARKDOWN_REHYPE_PLUGINS`, `MARKDOWN_REHYPE_HTML_ONLY_PLUGINS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { PluggableList } from 'unified';`；`import rehypeKatex from 'rehype-katex';`；`import type { Options as RehypeKatexOptions } from 'rehype-katex';`；`import rehypeSlug from 'rehype-slug';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/markdownPlugins.ts#L1-L14)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/markdownTransforms.ts`**
- 源码声明的类型、组件或调用边界：`OpenFence`, `getOpeningFence`, `match`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/markdownTransforms.ts#L1-L89)。
- **`jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/math/remarkLatexDelimiters.ts`**
- 源码声明的类型、组件或调用边界：`TokenTypeMap`, `LatexDelimiterTokens`, `MarkdownProcessorData`, `BACKSLASH`, `LEFT_PARENTHESIS`, `RIGHT_PARENTHESIS`, `LEFT_SQUARE_BRACKET`, `RIGHT_SQUARE_BRACKET`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Extension as FromMarkdownExtension, Handle } from 'mdast-util-from-markdown';`；`import type { Code, Construct, Effects, Extension as MicromarkExtension, State, Token } from 'microm`；`import type { Processor } from 'unified';`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/MarkdownRenderer/math/remarkLatexDelimiters.ts#L1-L193)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/components-markdownrenderer/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
