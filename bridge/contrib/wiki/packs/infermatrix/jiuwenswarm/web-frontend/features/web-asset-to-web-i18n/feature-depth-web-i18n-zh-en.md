---
name: feature-depth-web-i18n-zh-en
description: Web 前端中英双语 i18n 初始化实现深读：模块导入时链式注册 LanguageDetector/initReactI18next 并 init、默认导出实例与 addResourceBundle 用法、detection 仅 localStorage 且 fallbackLng 为 zh、三件套依赖、放弃 navigator 检测的取舍、inputAreaPermissionMerge 测试覆盖范围
metadata:
  scope: 收 src/i18n/index.ts 初始化的七个 facet 深读，来源另含 extensionDemoMain.tsx；后端 locale.get_conf 同步与 App 层行为归 feature-web-i18n-zh-en
---
# Web 前端中英双语 i18n 初始化：实现深读

## 现状

- [[feature-web-i18n-zh-en]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **模块导入时链式注册插件并调用 init（配置结果未在所示行内确认）** 导入 i18next 实例后依次 .use(LanguageDetector)、.use(initReactI18next)，再以 zh/en 两个 translation 资源调用 init，完成语言检测与 React 绑定的配置；init 是否同步完成未在所示行内展示。
- 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L1-L28)
- **契约仅为默认导出该 i18n 实例；扩展方可对 zh/en 追加 translation 资源包** 模块默认导出已配置的 i18n 实例（L30）。fixture 演示调用方用法：对 ['zh','en'] 逐语言 addResourceBundle(language, 'translation', bundle, true, false)，随后以 i18n.exists(key,{lng}) 校验两种语言键是否存在。
- 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L30–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L30-L30),
  - [jiuwenswarm/channels/web/frontend/tests/fixtures/settings-extension/extensionDemoMain.tsx:L17–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/fixtures/settings-extension/extensionDemoMain.tsx#L17-L20)
- **detection 仅用 localStorage，未检出时默认中文** detection.order 与 caches 均为 ['localStorage']，不支持 navigator；fallbackLng: 'zh'，supportedLngs: ['zh','en']，interpolation.escapeValue 为 false。即首次无 localStorage 的访客固定得到中文。
- 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L15–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L15-L27)
- **i18next + react-i18next + i18next-browser-languagedetector 三件套** LanguageDetector 只负责 localStorage 检测（order 限定），initReactI18next 挂接 React；语言资源静态来自 ./locales/zh.json 与 en.json，随模块导入打包。
- 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1–L14](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L1-L14)
- **localStorage 未缓存语言时的回退：fallbackLng 为 zh** detection.order 仅含 'localStorage'（L25），不会读取 navigator；注释（L23–L24）说明未手动选择语言时默认中文。结合 init 的 fallbackLng: 'zh'（L17），当 localStorage 中没有已缓存的语言时，初始化结果落在 zh 资源上。supportedLngs 限定为 ['zh','en']（L18）。
- 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L15–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L15-L28)
- **放弃 navigator 检测：避免英文闪烁 vs 牺牲浏览器语言偏好** 设计推断（非作者历史意图）：
- （推断）收益：注释写明桌面 WebView2 常为 en-US，不用 navigator 可避免启动初期误显英文，且与后端 preferred_language 默认一致；代价：无 localStorage 的英文浏览器用户首次访问也会看到中文，需手动切换。
- 来源：[jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L22–L27](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L22-L27)
- **现有 DOM 测试以 zh/en 运行打包后的 i18n 模块并断言 tooltip 文案已翻译（仅覆盖运行时翻译使用）** tests/inputAreaPermissionMerge.test.mjs 导入打包产物中的生产 i18n 模块（i18n/index.js），mount 前调用 i18n.changeLanguage(language)，并对 'zh' 与 'en' 各跑一个用例；断言 tooltip.textContent 等于 i18n.t('chat.config.mode.clusterDesc') 且不等于未翻译键名。
  - 该测试验证切换语言后 t() 产出翻译文案，不覆盖 i18n 初始化的 fallbackLng/detection 默认路径。
- 来源：[jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs:L90–L94](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs#L90-L94),
  - [jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs:L149–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs#L149-L161),
  - [jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs:L229–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs#L229-L247),
  - [jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/i18n/index.ts#L1-L30)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-web-i18n-zh-en.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L15-L27；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1-L14
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L22-L27；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L30-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/fixtures/settings-extension/extensionDemoMain.tsx:L17-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L15-L28；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs:L90-L94
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs:L149-L161
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/inputAreaPermissionMerge.test.mjs:L229-L247；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/i18n/index.ts:L1-L30
- 源页字段（feature）：web-i18n-zh-en
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/i18n/index.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/i18n/index.ts；jiuwenswarm/channels/web/frontend/src/App.tsx
