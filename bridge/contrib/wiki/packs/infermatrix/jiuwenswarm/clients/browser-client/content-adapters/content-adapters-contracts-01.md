---
name: content-adapters-contracts-01
description: content-adapters 源码接口与集成边界 01：arxiv.ts、github.ts、hackernews.ts、pubmed.ts、sec.ts、twitter.ts 等 8 个模块
metadata:
  scope: 只收 content/adapters 下 arxiv.ts 至 youtube.ts 共 8 个源码文件的静态声明（接口、类型、依赖与源码依据链接）
---
# content-adapters 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/browser/frontend/src/content/adapters/arxiv.ts`**
- 源码声明的类型、组件或调用边界：`extractArxiv`, `parts`, `titleEl`, `title`, `authors`, `abstract`, `body`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/adapters/arxiv.ts#L1-L33)。
- **`jiuwenswarm/channels/browser/frontend/src/content/adapters/github.ts`**
- 源码声明的类型、组件或调用边界：`extractGitHub`, `title`, `parts`, `article`, `body`, `comments`, `desc`, `topics`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/adapters/github.ts#L1-L40)。
- **`jiuwenswarm/channels/browser/frontend/src/content/adapters/hackernews.ts`**
- 源码声明的类型、组件或调用边界：`extractHackerNews`, `url`, `extractItem`, `parts`, `titleEl`, `title`, `linkedUrl`, `subtext`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/adapters/hackernews.ts#L1-L82)。
- **`jiuwenswarm/channels/browser/frontend/src/content/adapters/pubmed.ts`**
- 源码声明的类型、组件或调用边界：`extractPubmed`, `parts`, `titleEl`, `title`, `authors`, `abstract`, `fullText`, `mesh`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/adapters/pubmed.ts#L1-L26)。
- **`jiuwenswarm/channels/browser/frontend/src/content/adapters/sec.ts`**
- 源码声明的类型、组件或调用边界：`extractSec`, `title`, `parts`, `formContent`, `filingHeader`, `docBody`, `cloned`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/adapters/sec.ts#L1-L28)。
- **`jiuwenswarm/channels/browser/frontend/src/content/adapters/twitter.ts`**
- 源码声明的类型、组件或调用边界：`extractTwitter`, `parts`, `title`, `articles`, `processed`, `textEl`, `text`, `authorEl`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/adapters/twitter.ts#L1-L47)。
- **`jiuwenswarm/channels/browser/frontend/src/content/adapters/wikipedia.ts`**
- 源码声明的类型、组件或调用边界：`extractWikipedia`, `titleEl`, `title`, `parts`, `content`, `clone`, `noiseSelectors`, `stopHeadings`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/adapters/wikipedia.ts#L1-L49)。
- **`jiuwenswarm/channels/browser/frontend/src/content/adapters/youtube.ts`**
- 源码声明的类型、组件或调用边界：`extractYouTube`, `parts`, `titleEl`, `title`, `channel`, `desc`, `transcript`, `extractTranscriptFromInitialData`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/browser/frontend/src/content/adapters/youtube.ts#L1-L94)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/browser-client/content-adapters/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
