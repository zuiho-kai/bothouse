---
name: feature-yuanrong-agent-file-transfer
description: YuanRong Agent 容器文件传输：前端客户端与网关 HTTP 路由两层结构、mode 与 max_depth 等关键参数、四个异步文件方法、/file-api 流式下载与 download 分支、416 归一化为 EOF 空块与 trace_id 复用
metadata:
  scope: 只收容器文件上传、下载、列举与建目录的功能概览；mkdir 校验与下载实现的证据归 feature-depth-yuanrong-agent-file-transfer
---
# YuanRong Agent 容器文件传输（上传/下载/列举/建目录）

## 现状

- **两层结构：YuanRong 前端客户端与网关 HTTP 路由**
- 下层是 `YuanRongFrontendAgentClient`：同步 HTTP 通过 `asyncio.to_thread` 包成异步，统一经 `bind_southbound_trace_id` 绑定 trace，错误集中在 `_agent_file_http_error` 分类抛 `YuanrongAgentFileError`。
  - 上层是 WebChannel 的 `/file-api` 路由（`attach_container_file_routes`）：仅当 `channel.container_file_client` 是 `AgentOSRouterClient` 时挂载，各路由把请求转成 `client.upload/download/list_container_files`、`mkdir_container_dir` 调用。路由前置一个 HTTP 中间件调用 `client.authenticate_http` 做鉴权并把 IAM 身份写入 request.state。
  - 下载 `/file-api/download` 有两条分支：`verified_asset_v1` token 经 `fetch_agent_unary` 向 AgentServer 取验证分块；否则从 token 解出 path/session 后走 `download_container_file` 以 64KiB 分块流式输出。所示片段未包含 AgentOSRouterClient 实现，其调用是否落到上述 YuanRong files 接口无法在本次证据内确认。
- Sources / 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L804–L812](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L804-L812),
  - [jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L469–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L469-L479),
  - [jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L489–L549](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L489-L549),
  - [jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L698–L743](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L698-L743)
- **关键参数：mode、max_depth 与轮询超时**
- `mkdir` 的 `mode` 是可选的：None 或空白字符串归一化为 None（由调用方 umask 决定），仅当给出时才要求匹配 3-4 位八进制数字（如 755 或 0700），否则抛 `YuanrongAgentFileError(BAD_REQUEST)`；网关 `/file-api/mkdir` 同样接受可空的 `mode` 查询参数。`max_depth` 只出现在列举链路（客户端 `list_agent_files` 和网关 `ListFilesQuery`/`_list_container_dir`），mkdir 无此参数；
  - 负值处理不对称——客户端抛 `ValueError`（yuanrong_frontend_client.py:902-903），网关返回 HTTP 400（container_file_http.py:564-565）。另外 `wait_until_running` 的超时与重试间隔可由实例属性覆盖，否则用模块常量 `_AGENT_RUNNING_TIMEOUT_SECONDS` / `_AGENT_RUNNING_RETRY_INTERVAL_SECONDS`。
- Sources / 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L1027–L1041](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1027-L1041),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L895–L903](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L895-L903),
  - [jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L55–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L55-L67),
  - [jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L563–L565](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L563-L565)
- **YuanrongFrontendAgentClient 的四个异步文件方法**
- `YuanrongFrontendAgentClient` 提供四个容器文件异步方法：`upload_agent_file(instance_id, path, data, *, auth_headers, trace_id)`（POST /api/agent/:id/files/upload）、`download_agent_file(instance_id, path, *, offset=0, limit=65536, ...)` 返回 `AgentFileDownloadChunk`、
  - `list_agent_files(..., recursive=False, max_depth=0, ...)` 和 `mkdir_agent_dir(..., mode=None, recursive=False, ...)`。每个方法先 `_ensure_connected()`（未连接抛 RuntimeError），对空 instance_id/path 抛 `ValueError`，然后经 `bind_southbound_trace_id` 绑定 trace 并用 `asyncio.to_thread` 把同步 HTTP 调用移出事件循环。
- Sources / 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L780–L812](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L780-L812),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L814–L922](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L814-L922),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L924–L967](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L924-L967)
- **网关 /file-api 的流式下载与两条 download 分支**
- `/file-api/raw-file` 默认先取首个分块确定 Content-Type，再按 `_STREAM_CHUNK` 分块循环 `download_container_file` 并以 `StreamingResponse` 流式输出（带 `Cache-Control: no-store`）；
  - `/file-api/download` 则分两条路径：`kind` 为验证资产 token 时经 `fetch_agent_unary`（`ReqMethod.FILE_DOWNLOAD_VERIFIED_CHUNK`）向 AgentServer 取块并支持单区间 Range（206/416），否则从 token 解出 path/session 后走 `download_container_file` 分块流式下载。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L653–L674](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L653-L674),
  - [jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L698–L743](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L698-L743),
  - [jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L824–L870](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/container_file_http.py#L824-L870)
- **416 归一化为 EOF 空块与 trace_id 复用策略**
- 下载在 HTTP 416（offset 已到/越过 EOF）时不向上抛 Range 错误，而是返回一个 `data=b""`、`eof=True` 的空 `AgentFileDownloadChunk`，使网关 /file-api 把它当作成功的空读取（代码注释明确此意图）。trace_id 方面，显式传入的 trace_id 会被保留复用（测试中 create/delete/get 三次调用使用同一 id），仅未显式提供时才每次铸造新 id。
- Sources / 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L855–L867](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L855-L867),
  - [tests/unit_tests/extensions/test_yuanrong_frontend_client.py:L330–L366](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/extensions/test_yuanrong_frontend_client.py#L330-L366)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-yuanrong-agent-file-transfer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L804-L812；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L469-L479
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L489-L549；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L698-L743
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1027-L1041；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L895-L903
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L55-L67；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L563-L565
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L780-L812；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L814-L922
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L924-L967；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L653-L674
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/container_file_http.py:L824-L870；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L855-L867
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/extensions/test_yuanrong_frontend_client.py:L330-L366
- 源页字段（feature）：yuanrong-agent-file-transfer
- 入口（entry_points）：jiuwenswarm/extensions/yuanrong_frontend_client.py
- 源页字段（source_globs）：jiuwenswarm/extensions/yuanrong_frontend_client.py；jiuwenswarm/gateway/channel_manager/web/container_file_http.py
