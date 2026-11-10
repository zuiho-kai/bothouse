---
name: feature-web-i18n-zh-en
description: Web 前端中英双语 i18n 概览：静态资源加本地检测加后端 preferred_language 同步的分层、init 选项与检测顺序、zh/en 打包资源、changeLanguage 同步与静默失败、默认中文取舍、运行时防护（无自动化测试）
metadata:
  scope: 只收架构、配置、功能、API、取舍、验证六个 facet 摘要；init 回退路径、addResourceBundle 与 DOM 测试细节归 feature-depth-web-i18n-zh-en
---
# Web 前端中英双语 i18n 初始化（jiuwenswarm/channels/web/frontend）

## 现状

- **静态资源 + 本地检测 + 后端同步的分层**
- 前端 i18n 分两层：初始化层在模块加载时把 zh/en 两份 JSON 静态 import 进 `resources`，经 `LanguageDetector`（只查/只写 localStorage）与 `initReactI18next` 完成配置；运行层在 App 组件中，`isConnected` 变化触发的 effect 从后端 `locale.get_conf` 读取 `preferred_language` 并调用 `changeLanguage` 同步显示语言（注释说明与 config.yaml 保持一致）。
  - 因此启动初期语言由 localStorage 缓存决定，无缓存时落到 fallbackLng 'zh'；连接后可能被后端值覆盖（含 en）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L1-L30),
  - [jiuwenswarm/channels/web/frontend/src/App.tsx:L2114–L2125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L2114-L2125)
- **init 选项与检测顺序**
- `i18n.init` 的关键设置：`fallbackLng: 'zh'`、`supportedLngs: ['zh', 'en']`、`interpolation.escapeValue: false`、`detection.order` 与 `detection.caches` 均为 `['localStorage']`。源码注释说明意图：未手动选择语言时默认中文（与后端 `preferred_language` 默认值一致），不跟随 navigator，因为桌面 WebView2 常为 en-US 会导致启动初期显示英文。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L15–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L15-L28)
- **支持的双语行为与依赖**
- 支持中文（zh）与英文（en）两种语言，翻译文案来自静态打包的 `./locales/zh.json` 与 `./locales/en.json`，无运行时按需加载；语言选择持久化在 localStorage。组件通过 react-i18next 的 `t()` 消费翻译（如 App.tsx 的外部 CLI 文件选择标题），且后端 `preferred_language`（仅 zh/en 值时）会在连接后覆盖前端显示语言。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L1-L18),
  - [jiuwenswarm/channels/web/frontend/src/App.tsx:L1878–L1898](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L1878-L1898),
  - [jiuwenswarm/channels/web/frontend/src/App.tsx:L2114–L2125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L2114-L2125)
- **初始化入口与运行时语言同步**
- `src/i18n/index.ts` 在模块加载时链式调用 `i18n.use(LanguageDetector).use(initReactI18next).init({...})` 完成配置，并默认导出该 i18n 实例供其他模块引用。
  - 运行时语言切换的公开途径是实例方法 `i18n.changeLanguage(lang)`：App 组件在 `isConnected` 变为真后通过 `webRequest('locale.get_conf')` 读取后端 `preferred_language`，仅当值为 `'zh'` 或 `'en'` 时调用 `changeLanguage`，请求失败被空的 `.catch(() => {})` 静默吞掉，不影响主流程。组件层消费翻译使用 `t()`（如 `t("config.externalCli.selectFileTitle", { agent })`）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L12–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L12-L30),
  - [jiuwenswarm/channels/web/frontend/src/App.tsx:L2114–L2125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L2114-L2125),
  - [jiuwenswarm/channels/web/frontend/src/App.tsx:L1878–L1898](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L1878-L1898)
- **默认中文与 localStorage-only 检测的取舍**
- 检测顺序与缓存均只含 `localStorage`，且 `fallbackLng: 'zh'`：源码注释明确意图——未手动选择语言时默认中文（与后端 `preferred_language` 默认值一致），不跟随 navigator，因为桌面 WebView2 常为 en-US 会导致启动初期显示英文；代价是非中文浏览器用户在首次手动选择或后端同步之前先看到中文。另一取舍是后端同步的健壮性：`locale.get_conf` 返回非 zh/en 值时静默忽略、请求失败时静默吞掉，换取语言同步失败不阻塞连接后的主流程。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L17–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L17-L27),
  - [jiuwenswarm/channels/web/frontend/src/App.tsx:L2114–L2125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L2114-L2125)
- **语言同步的运行时防护（非自动化测试）**
- 所示代码中该功能的健壮性保障是运行时防护而非测试：连接后同步 `locale.get_conf` 的 effect 只在后端 `preferred_language` 严格等于 `'zh'` 或 `'en'` 时才调用 `i18n.changeLanguage`，其余值被忽略；请求失败由空的 `.catch(() => {})` 静默吞掉，保证语言同步失败不阻塞连接后的主流程。所展示的文件片段中未包含针对 i18n 初始化或语言同步的自动化测试入口，此处仅描述运行时守卫，不构成测试执行证据。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/App.tsx:L2114–L2125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L2114-L2125),
  - [jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L12–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L12-L28)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-web-i18n-zh-en.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1-L30；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L2114-L2125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L15-L28；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L1878-L1898；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L12-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L17-L27；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L12-L28
- 源页字段（feature）：web-i18n-zh-en
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/i18n/index.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/i18n/index.ts；jiuwenswarm/channels/web/frontend/src/App.tsx
