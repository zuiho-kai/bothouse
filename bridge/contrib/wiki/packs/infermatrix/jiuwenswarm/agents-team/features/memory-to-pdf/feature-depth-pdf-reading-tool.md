---
name: feature-depth-pdf-reading-tool
description: read_pdf 实现深读：异步签名、max_chars 默认 50_000 与钳制、每调用 100 页上限、pdfplumber 延迟导入与路径解析、异常转错误字符串、运行时单测
metadata:
  scope: 只收read_pdf 的入参归一化、路径解析与错误处理的实现细节；功能概览归 feature-pdf-reading-tool
---
# 分页 PDF 文本读取工具（read_pdf）：实现深读

## 现状

- [[feature-pdf-reading-tool]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **异步工具签名：必填 pdf_path，可选 pages 与 max_chars，返回 str** read_pdf(pdf_path: str, pages: Any = None, max_chars: int = DEFAULT_MAX_CHARS, **kwargs) 为 @tool 注册的异步函数，返回 str；任何异常被捕获并返回 "[ERROR]: read_pdf failed: {exc}"，kwargs 被忽略。
- 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L239–L262](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L239-L262),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L263–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L263-L275)
- **max_chars 默认 50_000，被钳制到 [1_000, 200_000]，每次调用最多 100 页** DEFAULT_MAX_CHARS = 50_000，_MAX_CHARS_CEILING = 200_000，_MAX_PAGES_PER_CALL = 100。_normalize_request 里 max_chars 取整失败回退默认值，再经 max(1_000, min(max_chars, 200_000)) 钳制；页选择在 _read_pdf_sync 中被 selected[:_MAX_PAGES_PER_CALL] 截断。
- 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L24–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L24-L26),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L117–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L117-L122),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L143–L143](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L143-L143)
- **pdfplumber 延迟导入；相对路径依赖 openjiuwen get_workspace** _read_pdf_sync 在路径校验之后才 import pdfplumber，使缺依赖环境仍能先报路径错误；_resolve_pdf_path 对非绝对路径导入 openjiuwen.core.sys_operation.cwd.get_workspace 拼接，取不到 workspace 时抛 ValueError。
- 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L125–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L125-L130),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L92–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L92-L101)
- **每调用最多 100 页的上限换来输出有界，代价是超大文档必须分多次调用** 设计推断（非作者历史意图）：
- selected 截断到 _MAX_PAGES_PER_CALL(100)，被跳过的页会触发披露说明：当总页数不超过 100 时建议省略 pages 整读，否则提示从第一个未读页继续调用（推断：该设计以多次调用的代价控制单次返回规模）。
- 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L143–L163](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L143-L163),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L201–L208](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L201-L208)
- **运行时单测直接 await read_pdf.invoke 断言输出内容** test_read_pdf_extracts_pages_and_flags_blank 构造 3 页 PDF 后 await read_pdf.invoke({"pdf_path": ...})，断言 "total pages: 3"、"--- Page 1 ---"、页文本和 "no text layer" 均在结果中（pdfplumber 缺失时 importorskip 跳过）。此为证据所述测试内容，非本次执行结果。
- 来源：[tests/unit_tests/agents/test_pdf_tools.py:L146–L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_pdf_tools.py#L146-L159)
- **read_pdf 归一化入参后经 asyncio.to_thread 执行同步提取，异常转为错误字符串返回** async 入口 read_pdf 将三个入参交给 _normalize_request：pdf_path 去首尾空白后为空即抛 ValueError；max_chars 先按 int() 转换，仅在转换抛出 TypeError 或 ValueError 时回退 DEFAULT_MAX_CHARS，再被夹在 [1_000, _MAX_CHARS_CEILING] 区间。
  - 随后 logger.info 记录归一化后的 path/pages/max_chars，并通过 asyncio.to_thread 把 _read_pdf_sync 卸载到线程；该同步函数先调用 _resolve_pdf_path 校验路径，再 import pdfplumber 并 open 文件，按 total_pages 过滤出 selected 页（超出总页数的请求页归入 out_of_range），selected 再被截断到 _MAX_PAGES_PER_CALL，随后开始构造 header 字符串。
  - 以上任何一步抛出的 Exception 都被 read_pdf 的 except 捕获，函数返回字符串 "[ERROR]: read_pdf failed: {exc}"。
- 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L257–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L257-L275),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L112–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L112-L122),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L125–L145](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L125-L145)
- **路径/规整阶段抛出的 ValueError 与 FileNotFoundError 在 read_pdf 内被 except Exception 转为错误字符串返回** _resolve_pdf_path 对空值抛 ValueError("pdf_path cannot be empty")，相对路径在 get_workspace() 失败或为空时抛 ValueError("read_pdf runtime workspace is unavailable")，文件不存在抛 FileNotFoundError，非文件或后缀非 .pdf 抛 ValueError；
  - _normalize_request 对空 pdf_path 抛 ValueError。这些异常在 read_pdf 的 except Exception 分支被捕获并作为字符串 "[ERROR]: read_pdf failed: {exc}" 返回给调用者；该分支仅捕获 Exception，不代表所有可抛对象都被转换。
- 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L86–L109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L86-L109),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L112–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L112-L116),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L274–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L274-L275)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-pdf-reading-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L24-L26；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L117-L122
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L143-L143；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_pdf_tools.py:L146-L159
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L239-L262；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L263-L275
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L125-L130；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L92-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L143-L163；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L201-L208
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L86-L109；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L112-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L274-L275；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L257-L275
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L112-L122；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L125-L145
- 源页字段（feature）：pdf-reading-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/pdf_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/pdf_tools.py
