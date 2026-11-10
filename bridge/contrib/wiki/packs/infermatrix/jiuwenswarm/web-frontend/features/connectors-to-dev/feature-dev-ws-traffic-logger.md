---
name: feature-dev-ws-traffic-logger
description: Vite Dev WS Traffic Logger（/__dev/ws-log）：devWsTrafficLogger 插件写入 agent/.logs/ws-dev.log 的职责与 maskSensitive 脱敏、GET/POST/405 接口契约、limit 参数与日志路径、LogsPanel 经 file-api 读取日志与 wsDisableCompress 开关、文件即缓冲取舍与验证入口
metadata:
  scope: 只收 dev WS 流量日志插件与 LogsPanel 展示的现状说明与设计推断；POST 回调、limit 夹取、maskSensitive 细节、读写错误码与每次启动清空日志的逐点证据归 feature-depth-dev-ws-traffic-logger
---
# Vite Dev WS Traffic Logger (/__dev/ws-log)

## 现状

- **职责与数据流**
- Inference / 设计推断（非作者历史意图）：
- 插件 `devWsTrafficLogger()` 在 `configureServer` 中定位 `agent/.logs/ws-dev.log`，启动时 mkdir + 清空日志（注释说明是为避免历史数据干扰排查），随后作为 Vite 中间件接收前端上报的 /ws req/res/event 报文。写入前调用 `maskSensitive` 递归脱敏，注释指出算法与后端 SensitiveDataFilter 一致，避免 api_key/token 明文落盘并便于跨端关联。展示的代码未包含前端上报端（fetch POST 调用方），数据流中“前端→vite”一侧为推断。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L350–L363](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L350-L363),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L423–L429](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L423-L429)
- **验证入口**
- Inference / 设计推断（非作者历史意图）：
- 展示范围内未见针对该插件或 `/__dev/ws-log` 的测试文件。LogsPanel 组件带有稳定的 `data-testid`（logs-panel、logs-panel-debug-toggle、logs-panel-auto-refresh-toggle、logs-panel-content 等），并区分 wsDisableCompress 开/关时的计数文案（countVisible vs countVisibleTotal），可作为 UI 层测试锚点；这些 testid 是否被实际测试使用，需查仓库测试目录确认。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L161–L215](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx#L161-L215)
- **接口契约：GET 查询与 POST 追加**
- Vite 插件 `devWsTrafficLogger()` 在 `configureServer` 中向 dev server 注册 `/__dev/ws-log` 中间件。GET 返回 `{ok, entries, count}`：读取整个日志文件后按行 split、逐行 trim、过滤空行、取末尾 limit 条，每行尝试 JSON.parse，失败则原样返回该行字符串；文件不存在（ENOENT）时返回 200 与空 entries，其他读错误返回 500 `{ok:false, error:'read_failed'}`。
  - POST 累积请求体后 JSON.parse（失败则保留原文），先经 `maskSensitive` 递归脱敏，再以 `{ts, payload}` 的 JSONL 行 append 到日志；非 GET/POST 返回 405 `{ok:false, error:'method_not_allowed'}`。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L363–L407](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L363-L407),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L409–L433](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L409-L433)
- **可调项：limit 参数与日志路径**
- 日志路径由代码从项目根推导：`agent/.logs/ws-dev.log`，目录在 dev server 启动时递归创建并清空日志文件（注释说明是为避免历史数据干扰排查）。GET 支持 `limit` 查询参数，默认 300，非有限值回退 300，有效值被夹在 1–2000 之间。另有关联的调试开关：LogsPanel 通过 `/file-api/ws-debug-config` 读写 `wsDisableCompress` 布尔值，成功后派发 `jiuwenclaw:ws-reconnect-request` 自定义事件。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L354–L367](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L354-L367),
  - [jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L85–L127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx#L85-L127)
- **支持的行为：落盘、脱敏与面板展示**
- 插件在写盘前调用 `maskSensitive` 对 payload 递归脱敏，注释指出这是为了应对前端上报 config.get/config.validate_model 等含 api_key/token/secret 的报文，并称算法与后端 SensitiveDataFilter 一致（该一致性为注释声明，实现未在展示范围内）。
  - 前端 LogsPanel 不走 `/__dev/ws-log` 的 GET，而是通过 `/file-api/file-content?path=agent/.logs/ws-dev.log` 读取原始 JSONL，本地解析末尾 300 条，autoRefresh 开启时每 3 秒轮询；当 wsDisableCompress 关闭时过滤调试条目（含 `[ws][`、`/__dev/ws-log` 字样，或形如 ts+payload 对象的记录）。
  - 后端 app_web.py 另有 `_log_ws_business_message` 将 req/res 报文格式化为带截断的 `[ws][方向][类型]` 日志行。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L423–L429](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L423-L429),
  - [jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L41–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx#L41-L76),
  - [jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L134–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx#L134-L149),
  - [jiuwenswarm/channels/web/app_web.py:L467–L490](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L467-L490)
- **设计取舍：文件即缓冲与脱敏前置**
- Inference / 设计推断（非作者历史意图）：
- 插件选择把报文以 JSONL 追加到固定路径 `agent/.logs/ws-dev.log`，而不是内存环形缓冲：好处是 LogsPanel 可以绕开 `/__dev/ws-log` 的 GET，直接通过 `/file-api/file-content` 读原始文件，且文件天然跨请求持久；代价是每次 GET 要整读文件再切片，且 dev server 每次启动会清空日志（注释说明为避免历史数据干扰排查），重启即丢历史。
  - 写入前调用 `maskSensitive` 递归脱敏，注释指出意图是防止 config.get 等报文中的 api_key/token 明文落盘，并称算法与后端 SensitiveDataFilter 一致——该一致性及 `maskSensitive` 的具体实现（是否含类似后端 `_truncate_for_ws_log` 的长度截断）在展示范围内不可见，仅为注释声明。作为对比，后端 `_log_ws_business_message` 路径对字段有明确的字符数截断处理。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L355–L367](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L355-L367),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L423–L429](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L423-L429),
  - [jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L65–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx#L65-L76),
  - [jiuwenswarm/channels/web/app_web.py:L451–L465](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/app_web.py#L451-L465)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-dev-ws-traffic-logger.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L350-L363；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L423-L429
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L161-L215；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L363-L407
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L409-L433；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L354-L367
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L85-L127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L41-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L134-L149；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L467-L490
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L355-L367；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx:L65-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/app_web.py:L451-L465
- 源页字段（feature）：dev-ws-traffic-logger
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/vite.config.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/vite.config.ts；jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx；jiuwenswarm/channels/web/app_web.py
