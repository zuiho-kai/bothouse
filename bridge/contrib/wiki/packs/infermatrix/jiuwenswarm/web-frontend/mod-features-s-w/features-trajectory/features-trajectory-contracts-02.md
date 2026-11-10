---
name: features-trajectory-contracts-02
description: features-trajectory 源码接口 02：trajectory/primitives 的 icons（index、props）、markdown（CodeBlock、MarkdownText、cjkFriendlyStrong、highlight、incremental、katex、mathCompatibility、parse、plain-text、render）与 pointer-grace.ts 的声明与导入依赖
metadata:
  scope: 只收 trajectory/primitives 下 icons、markdown 与 pointer-grace.ts 的接口记录；JsonTree、Menu、Tooltip 归 features-trajectory-contracts-01，projector 与 semconv 归 features-trajectory-contracts-03
---
# features-trajectory 源码接口与集成边界 02

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/icons/index.tsx`**
- 源码声明的类型、组件或调用边界：`IconNewChatOutline16`, `IconSearchOutline16`, `IconGlobeOutline14`, `IconSettingsOutline14`, `IconSettingsOutline16`, `IconPanelLeftOutline16`, `IconEllipsisOutline16`, `IconPlusOutline16`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { IconProps } from './props.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/icons/index.tsx#L1-L874)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/icons/props.ts`**
- 源码声明的类型、组件或调用边界：`IconProps`；这是词法声明索引，不把局部变量当成对外导出 API。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/icons/props.ts#L1-L10)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/CodeBlock.tsx`**
- 源码声明的类型、组件或调用边界：`CodeBlockProps`, `CodeBlock`, `trimmed`, `loaded`, `html`, `rootRef`, `onCopy`, `text`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'`；`import clsx from 'clsx'`；`import { writeClipboard } from '../clipboard.ts'`；`import { grammarLoadCount, highlightToHtml, subscribeGrammarLoaded } from './highlight.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/CodeBlock.tsx#L1-L76)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/MarkdownText.tsx`**
- 源码声明的类型、组件或调用边界：`renderSettled`, `root`, `targets`, `context`, `blocks`, `section`, `StreamingRenderer`, `newlyFrozen`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { memo, useMemo, useRef } from 'react'`；`import type { ReactNode } from 'react'`；`import { IncrementalMarkdownParser } from './incremental.ts'`；`import { parseGfm, parseGfmWithMath } from './parse.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/MarkdownText.tsx#L1-L178)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/cjkFriendlyStrong.ts`**
- 源码声明的类型、组件或调用边界：`cjkCharacter`, `isCjkCharacter`, `tokenizeCjkFriendlyAttention`, `configuredAttentionMarkers`, `attentionMarkers`, `previous`, `before`, `marker`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { attention } from 'micromark-core-commonmark'`；`import { unicodePunctuation } from 'micromark-util-character'`；`import { classifyCharacter } from 'micromark-util-classify-character'`；`import { codes, constants } from 'micromark-util-symbol'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/cjkFriendlyStrong.ts#L1-L85)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/highlight.ts`**
- 源码声明的类型、组件或调用边界：`LangModule`, `LANGS`, `LAZY_GRAMMARS`, `LANG_ALIASES`, `cssVariablesTheme`, `regexEngine`, `singleton`, `BOOT_GRAMMAR_WARMUPS`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'`；`import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascr`；`import langTs from '@shikijs/langs/typescript'`；
  - `import langBash from '@shikijs/langs/shellscript'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/highlight.ts#L1-L313)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/incremental.ts`**
- 源码声明的类型、组件或调用边界：`UNSTABLE_TAIL_BLOCKS`, `PositionedBlock`, `IncrementalBlocks`, `blockKey`, `offset`, `IncrementalMarkdownParser`, `base`, `blocks`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Root, RootContent } from 'mdast'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/incremental.ts#L1-L132)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/katex.tsx`**
- 源码声明的类型、组件或调用边界：`styleObject`, `style`, `declaration`, `colon`, `name`, `key`, `domToReact`, `element`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { createElement } from 'react'`；`import type { CSSProperties, ReactNode } from 'react'`；`import katex from 'katex'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/katex.tsx#L1-L92)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/mathCompatibility.ts`**
- 源码声明的类型、组件或调用边界：`previousBackslash`, `tail`, `tokenizeBackslashMathText`, `start`, `open`, `between`, `afterCloseAttempt`, `dataStart`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { factorySpace } from 'micromark-factory-space'`；`import type {} from 'micromark-extension-math'`；`import { markdownLineEnding } from 'micromark-util-character'`；`import { codes, constants, types } from 'micromark-util-symbol'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/mathCompatibility.ts#L1-L351)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/parse.ts`**
- 源码声明的类型、组件或调用边界：`parseGfm`, `parseGfmWithMath`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import type { Root } from 'mdast'`；`import { fromMarkdown } from 'mdast-util-from-markdown'`；`import { gfmFromMarkdown } from 'mdast-util-gfm'`；`import { mathFromMarkdown } from 'mdast-util-math'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/parse.ts#L1-L46)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/plain-text.ts`**
- 源码声明的类型、组件或调用边界：`MarkdownPlainTextMode`, `MarkdownPlainTextOptions`, `MarkdownNode`, `inlineText`, `compactInline`, `blockText`, `findFirstParagraph`, `text`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { parseGfm } from './parse.ts'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/plain-text.ts#L1-L123)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/render.tsx`**
- 源码声明的类型、组件或调用边界：`MarkdownCodeLabels`, `sanitizeUrl`, `remoteImageUrl`, `protocol`, `ReferenceTargets`, `createReferenceTargets`, `collectReferenceTargets`, `node`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { Fragment, createElement } from 'react'`；`import type { Key, ReactNode } from 'react'`；`import type * as Md from 'mdast'`；`import type {} from 'mdast-util-math'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/render.tsx#L1-L585)。
- **`jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/pointer-grace.ts`**
- 源码声明的类型、组件或调用边界：`POINTER_GRACE_MS`, `PointerGrace`, `usePointerGrace`, `timerRef`, `closeRef`, `cancel`, `arm`；这是词法声明索引，不把局部变量当成对外导出 API。
- 集成边界的导入/加载声明：`import { useCallback, useEffect, useRef } from 'react'`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/pointer-grace.ts#L1-L55)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/features-trajectory/source-contracts-02.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
