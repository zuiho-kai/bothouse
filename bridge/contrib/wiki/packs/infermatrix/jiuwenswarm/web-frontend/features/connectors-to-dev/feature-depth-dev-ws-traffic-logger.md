---
name: feature-depth-dev-ws-traffic-logger
description: Dev WS Traffic Logger 实现深读：POST 累积请求体并脱敏后以 JSONL 追加、limit 默认 300 并夹在 1–2000、maskSensitive 的 looksSecretKey/maskWithFp 例外、ENOENT 返回空列表与 read_failed/write_failed 的 500、每次 dev 启动清空日志的取舍
metadata:
  scope: 只收 vite.config.ts 中 devWsTrafficLogger 的实现级证据与设计推断；插件职责、LogsPanel 展示与接口契约总览归 feature-dev-ws-traffic-logger
---
# Vite Dev WS Traffic Logger (/__dev/ws-log)：实现深读

## 现状

- [[feature-dev-ws-traffic-logger]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **POST 回调累积请求体、脱敏后以 JSONL 追加写入日志** POST 分支用 req.on('data') 累积 raw，end 回调尝试 JSON.parse（失败保留原文），经 maskSensitive 脱敏后写成 `{ts,payload}` 行 append 到 ws-dev.log，成功返回 200 {ok:true}。
- 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L409–L441](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L409-L441)
- **limit 查询参数默认 300，非有限回退 300，有效值夹在 1–2000** 日志路径固定由 resolveProjectRootDir() 推导为 agent/.logs/ws-dev.log；configureServer 时 mkdirSync 递归建目录并 writeFileSync 清空文件。GET 的 limit 缺省 '300'，Number.isFinite 不满足时取 300，否则 clamp 到 1–2000。
- 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L355–L367](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L355-L367),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L157–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L157-L181)
- **POST 写盘前调用本地 maskSensitive，敏感键值整体掩码但空值/已脱敏/哈希异常有例外** POST 'end' 回调调用同文件的 maskSensitive（L427），后者递归处理对象/数组，键名命中 looksSecretKey 时将值经 maskWithFp 替换为 ******(fp:..)，字符串值再经 maskValueShapes 兜底；maskWithFp 内部空值返回 '******'、已脱敏值原样返回、createHash 异常返回 '******'。
  - 中间件本身依赖 fs（mkdirSync/writeFileSync/readFile/appendFile）与 path 解析 agent/.logs/ws-dev.log。与后端 SensitiveDataFilter 一致仅为注释声明。
- 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L36–L53](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L36-L53),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L89–L142](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L89-L142),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L423–L440](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L423-L440)
- **读错误 ENOENT 返回 200 空列表，其余 500；写失败 500** GET fs.readFile 出错且 code==='ENOENT' 时返回 200 {ok:true,entries:[],count:0}；其他读错误记 logger.error 并返回 500 {ok:false,error:'read_failed'}。POST appendFile 出错记 logger.error 并返回 500 {ok:false,error:'write_failed'}。
- 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L368–L382](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L368-L382),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L429–L436](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L429-L436)
- **每次 dev 启动清空日志便于排查，但代价是该文件中的历史条目被覆盖** 设计推断（非作者历史意图）：
- configureServer 里 mkdirSync 后 writeFileSync(logFile,'') 清空 ws-dev.log，注释说明是为避免历史数据干扰排查（收益）。成本（推断）：GET 走 readFile 全量读取再 slice(-limit)，日志增长时读取与解析开销随之增加；且清空使该文件中此前记录的条目不再可查。
- 来源：[jiuwenswarm/channels/web/frontend/vite.config.ts:L355–L367](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L355-L367),
  - [jiuwenswarm/channels/web/frontend/vite.config.ts:L383–L398](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/vite.config.ts#L383-L398)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-dev-ws-traffic-logger.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-07；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L409-L441；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L355-L367
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L157-L181；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L368-L382
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L429-L436；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L36-L53
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L89-L142；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L423-L440
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/vite.config.ts:L383-L398
- 源页字段（feature）：dev-ws-traffic-logger
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/vite.config.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/vite.config.ts；jiuwenswarm/channels/web/frontend/src/components/LogsPanel/index.tsx；jiuwenswarm/channels/web/app_web.py
