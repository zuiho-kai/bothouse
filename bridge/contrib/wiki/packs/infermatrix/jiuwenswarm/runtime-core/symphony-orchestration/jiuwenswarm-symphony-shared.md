---
name: jiuwenswarm-symphony-shared
description: Symphony 共享工具（symphony/shared）：storage.py 的 S3 读写与目录同步、llm_payload.py 载荷精简、profiling.py StageTimer、tags.py 标签归一化、rich_compat.py 兼容替身的入口与文件职责
metadata:
  scope: 只收 symphony/shared 目录的入口与关键文件说明；这些模块的逐文件接口声明归 symphony-orchestration-shared-contracts-01，图谱构建归 jiuwenswarm-symphony
---
# Symphony 共享工具（symphony/shared）

## 现状

- 为 Symphony 提供共享的底层工具：S3 对象存储的读写与目录同步、精简的 LLM 请求载荷、分阶段计时、标签归一化，以及 rich 终端组件的兼容替身。
- **从这里开始读**
- `jiuwenswarm/symphony/shared/storage.py` — S3 入口：is_s3_uri、parse_s3_uri、read_s3_text、upload_local_dir_to_s3、materialize_s3_dir、create_s3_client
- `jiuwenswarm/symphony/shared/llm_payload.py` — compact_json 与 prune_empty：用来精简发给 LLM 的请求载荷
- `jiuwenswarm/symphony/shared/tags.py` — normalize_tags：把各种形式的标签输入整理成去重后的字符串元组
- **关键文件**
- `jiuwenswarm/symphony/shared/storage.py` — S3Location 与 S3 URI 的解析和拼接、读取、下载、上传；从环境变量读取载荷签名和寻址风格；判断上传错误能否重试、对象是否缺失
- `jiuwenswarm/symphony/shared/llm_payload.py` — LLM 请求载荷的共享辅助：去掉空值，再序列化成紧凑 JSON
- `jiuwenswarm/symphony/shared/profiling.py` — StageTimer：按 scope 记录各 phase 的耗时，finish 时输出到 logger
- `jiuwenswarm/symphony/shared/tags.py` — 标签解析：拆分文本、递归展平嵌套值，并用 _seen 防止循环引用
- `jiuwenswarm/symphony/shared/rich_compat.py` — rich 的兼容替身，提供 Console、Panel、Progress、各种 Column 和 RichTree 的空实现，接口与 rich 一致
- **路由**
- `jiuwenswarm/symphony/shared/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/jiuwenswarm-symphony-shared.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
