---
name: feature-xiaoyi-pushdata-store-and-viewer
description: 推送记录持久化与查询概览：push_result_tool 的 view_push_result 入口、pushdata_manager 常量与默认值、JSON 文件存储取舍、两层结构与日志验证
metadata:
  scope: 只收 view_push_result / pushdata_manager 的功能概览；调用链、异常分支与测试等实现细节归 feature-depth-xiaoyi-pushdata-store-and-viewer
---
# 推送记录持久化与查询：pushdata_manager 与 view_push_result

## 现状

- **公开入口与返回契约**
- pushdata_manager 提供 save_push_data(data_detail) -> pushDataId（UUID 字符串）、search_push_data(keywords)、get_all_push_data() 与 clear_all_push_data()。push_result_tool 暴露 agent 工具 view_push_result(keywords, limit)，返回 content[0].text 为 JSON 字符串，含 success、count、items、message 字段；
  - 异常时捕获 Exception 返回 success:false 与 error 信息（查询本身不抛出）。工具层计算 effective_limit = min(limit or 10, 50)，负数 limit 不会被钳制，再经 results[:effective_limit] 截取。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L72–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L72-L100),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L36–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L36-L58),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L136–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L136-L152)
- **内置常量与默认值**
- 模块内固定两个常量，无外部配置入口：PUSHDATA_FILE 经 os.path.expanduser 展开为 ~/.openclaw/pushData.json，MAX_PUSHDATA_ITEMS = 1000。写入时以 items[-MAX_PUSHDATA_ITEMS:] 保留列表尾部（追加发生在尾部，故保留的是最近写入的条目，依据是位置而非时间排序），仅当输入超过 1000 条时才记录裁剪日志。时间戳格式为北京时间 YYYYMMDD HHmmss。工具层默认返回 10 条（limit or 10）。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L18–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L18-L25),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L54–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L54-L66),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L49-L51)
- **支持的行为**
- 关键词搜索为大小写不敏感的子串匹配，字段限定为 dataDetail 与 pushDataId；keywords 为 None 或空白时 search_push_data 返回全部条目，view_push_result 无关键词时走全量查询并按 effective_limit 截取（默认 10）。返回条目包含 pushDataId 前 8 位、完整 ID、time、dataDetail（超过 200 字符截断后追加 "..."，实际最长 203 字符）和 fullLength。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L103–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L103-L124),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L94–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L94-L108)
- **JSON 文件存储的取舍**
- 采用单文件 JSON 而非数据库，实现简单、可直接人工查看，且读取端对 JSON 解析失败、非数组内容和 OSError 均降级为返回空列表并记日志，使文件缺失或整体损坏不致读取崩溃。代价是每次 save 全量重写文件、容量受 1000 条截断限制；读取端仅校验外层是列表，不校验条目结构，畸形条目（如 [null]）会透传，view_push_result 中对每条调用 .get() 时可能抛出并落入 success:false 分支。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L34–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L34-L51),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L64–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L64-L69)
- **两层结构：持久化模块与工具层**
- 功能分两层。pushdata_manager.py 负责持久化：save_push_data 生成 UUID、以北京时间 YYYYMMDD HHmmss 为 time 组装条目，读出 ~/.openclaw/pushData.json 全量列表、追加后整体重写（写入时以 items[-1000:] 截断）。
  - push_result_tool.py 是面向 agent 的工具层：通过 openjiuwen.core.foundation.tool 的 @tool 装饰器注册 view_push_result，按是否有关键词选择调用 search_push_data 或 get_all_push_data，按 time 字符串倒序排序后截取条数，把结果序列化为 JSON 文本放入 content[0].text 返回。两文件均为所示范围，未见其他模块调用。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L72–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L72-L100),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L14–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L14-L18),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L49-L69)
- **验证手段：日志输出**
- 所示两个文件不含测试代码。执行路径上的验证手段是 logger 输出：pushdata_manager 在保存（id 前 8 位、time、detail 长度）、裁剪（trim 前后条数）、搜索命中数和清空时打 INFO 日志；push_result_tool 记录查询入参、数据源返回条数与查询方式、截取后条数，异常时打 ERROR 日志。读取失败（JSON 解析错误、OSError）记录 ERROR 并降级返回空列表。这些是格式化文本日志，所示输入中未提供以它们断言的自动化测试入口。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L54–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L54-L69),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L52–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L52-L69),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L136–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L136-L148)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-xiaoyi-pushdata-store-and-viewer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L72-L100
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L36-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L136-L152
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L18-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L54-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L103-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L94-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L34-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L64-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L14-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L54-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L52-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L136-L148
- 源页字段（feature）：xiaoyi-pushdata-store-and-viewer
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py；jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py；jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py
