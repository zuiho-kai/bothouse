---
name: feature-depth-xiaoyi-pushdata-store-and-viewer
description: view_push_result 与 pushdata_manager 实现深读：关键词查询路径、~/.openclaw/pushData.json 存储与 MAX_PUSHDATA_ITEMS=1000 封顶、默认 10 条与上限 50 条、读失败降级与写失败上抛、非原子覆盖写、装配测试
metadata:
  scope: 只收 view_push_result / pushdata_manager 的实现级事实；职责、配置与取舍的概览归 feature-xiaoyi-pushdata-store-and-viewer
---
# 推送记录持久化与查询 (pushdata_manager + view_push_result)：实现深读

## 现状

- [[feature-xiaoyi-pushdata-store-and-viewer]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **view_push_result 关键词查询路径：剥离空白、全量/搜索取数、按 time 倒序后截断** 调用 view_push_result(keywords, limit) 时，先用 min(limit or 10, 50) 求 effective_limit，keywords 为非空字符串时取 strip 后的关键词；有关键词走 search_push_data，否则 get_all_push_data；
  - 结果按 item.get("time", "") 倒序排序后截取前 effective_limit 条，非空时逐条格式化为 pushDataId 前 8 位、fullPushDataId、time、dataDetail 超过 200 字符截断加 "..."、fullLength，并以 success/count/totalMatched/items/message 的 JSON 文本返回。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L49-L69),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L94–L134](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L94-L134)
- **存储路径固定为 ~/.openclaw/pushData.json，写入选用最后 MAX_PUSHDATA_ITEMS=1000 条；查询条数默认 10、上限 50** 模块级常量 PUSHDATA_FILE = os.path.expanduser("~/.openclaw/pushData.json")、MAX_PUSHDATA_ITEMS = 1000；_write_pushdata_list 写入 items[-1000:]，超出时记录 info 日志。
  - view_push_result 中 effective_limit = min(limit or 10, 50)，即 limit 为 None 或 0 时取 10，任何超过 50 的值被压到 50。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L18–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L18-L19),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L54–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L54-L66),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L49-L51)
- **读失败降级为空列表、写失败上抛；工具层 except 兜底返回 success=False** _read_pushdata_list 捕获 (json.JSONDecodeError, OSError) 记 error 日志并 return []；_write_pushdata_list 捕获 OSError 记日志后 raise；view_push_result 的 try 包住全部逻辑，任何 Exception 返回 {success: False, error: str(e), message: "查询推送记录失败"}。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L34–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L34-L51),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L67–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L67-L69),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L136–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L136-L152)
- **记录条数封顶 1000 防止列表无限增长，但采用直接覆盖写（推断：非原子）且限制条数而非文件大小** 设计推断（非作者历史意图）：
- 写入限制在最后 1000 条（items[-MAX_PUSHDATA_ITEMS:]），防止记录无限累积（fact）。代价（推断）：open(..., "w") 直接截断重写整个文件，进程中断可能留下部分写入的 JSON，后续读取会因 JSONDecodeError 降级为 []；且限制的是条数而非 dataDetail 长度，单条超长时文件仍可能很大。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L56–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L56-L66),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L49–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L49-L51)
- **push_result_tool 从同包 pushdata_manager 导入并按 kw 分发到 search/get_all** push_result_tool.py L18 `from .pushdata_manager import search_push_data, get_all_push_data` 建立同包耦合；view_push_result 内 `results = search_push_data(kw) if kw else get_all_push_data()`（L58）依据剥离空白后的 kw 决定数据源。
  - search_push_data 与 get_all_push_data 均调用 _read_pushdata_list()（L121/L139），读取端共享同一实现。
- 来源：[jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L14–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L14-L18),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49–L62](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L49-L62),
  - [jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L112–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L112-L141)
- **既有 swarm 装配测试运行 _build_xiaoyi_phone_tools 并断言开关两态的工具数量（helper 单元级）** tests/agents/swarm/test_swarm_assembly.py 的 test_xiaoyi_phone_tools_gated_by_config 实际调用 tools._build_xiaoyi_phone_tools：config 为 {"channels":{"xiaoyi":{"phone_tools_enabled":True}}} 时断言返回 27 个工具，空 config 时断言返回 []。
  - 生产元组 _XIAOYI_PHONE_TOOLS 显式包含 view_push_result，故该测试覆盖查看工具经配置开关暴露的装配路径；断言仅为聚合计数，不校验单个工具身份，pushdata_manager 存储侧不在该测试内。该验证属 helper 单元级，且本次未执行。
- 来源：[tests/agents/swarm/test_swarm_assembly.py:L1872–L1880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/agents/swarm/test_swarm_assembly.py#L1872-L1880),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L121–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L121-L150),
  - [jiuwenswarm/agents/swarm/providers/tools.py:L461–L469](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/tools.py#L461-L469)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-xiaoyi-pushdata-store-and-viewer.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L34-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L67-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L136-L152
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L94-L134
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L18-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L54-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L56-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L49-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L14-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py:L49-L62
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py:L112-L141；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/agents/swarm/test_swarm_assembly.py:L1872-L1880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L121-L150；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/tools.py:L461-L469
- 源页字段（feature）：xiaoyi-pushdata-store-and-viewer
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py；jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py；jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py
