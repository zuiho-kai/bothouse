---
name: feature-pdf-reading-tool
description: read_pdf 分页 PDF 文本读取工具：支持的行为、入口与调用契约、100 页与 max_chars 的受限读取取舍、分层结构与执行流、内部常量与验证入口
metadata:
  scope: 只收read_pdf 工具的行为、契约与取舍概览；实现深读归 feature-depth-pdf-reading-tool
---
# read_pdf：分页 PDF 文本读取工具（feature-pdf-reading-tool）

## 现状

- **支持的行为**
- 支持增量分页读取：超出的请求页会被记为 out-of-range 跳过，未读页、截断和空文本页都以明确的文本披露回传，提示模型再次调用或改用视觉工具。扫描页（无文本层）输出 `[no text layer on this page]` 并在结尾汇总，建议用 image/vision 工具兜底。工具描述（模型可见文档）通过 f-string 引用常量，使上限与默认值改变时描述自动同步。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L170–L183](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L170-L183),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L213–L218](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L213-L218),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L244–L254](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L244-L254)
- **验证入口**
- Inference / 设计推断（非作者历史意图）：
- 本次固定版本展示的输入只有 pdf_tools.py 源文件本身，未附带任何测试文件或文档；该文件内没有内嵌的自测逻辑。无法从所示证据确认此工具的测试覆盖情况，validation  facet 以所示范围为限，不作存在性断言。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L1–L10](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L1-L10)
- **入口与调用契约**
- 公开入口是经 `@tool` 注册的异步函数 `read_pdf(pdf_path, pages=None, max_chars=50_000)`；`pages` 接受整数、列表或形如 `"1-5"`/`"1,3,8-10"` 的字符串，省略或为空表示读全部页，但实际读取仍受每次调用最多 100 页（`_MAX_PAGES_PER_CALL`）与 `max_chars` 字符截断约束。返回值为拼接的 Markdown 式文本；任何被 `except Exception` 捕获的异常都被转换为 `[ERROR]: read_pdf failed: ...` 字符串而非抛出。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L239–L262](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L239-L262),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L36–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L36-L41),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L273–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L273-L275)
- **受限读取与主动披露的取舍**
- Inference / 设计推断（非作者历史意图）：
- 读取量被页数上限（100 页/次，超出的选中页直接截断）和 `max_chars` 双重限制以保护上下文窗口，代价是模型必须多轮续读。两类遗漏的披露位置不同：因 `pages` 只选子集或页数上限截断而未读的页，在返回头部的 `[Partial read: ...]` 中列出并给出补救指引（总页数不超上限时建议省略 `pages`，否则提示从首个未读页续读）；而 `max_chars` 触发的截断在循环内追加尾部说明、列出未读页并建议调大 `max_chars`，且截断后即终止循环。路径校验先于 pdfplumber 导入，使依赖缺失环境下路径错误也能清晰呈现。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L143–L168](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L143-L168),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L185–L211](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L185-L211),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L125–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L125-L130)
- **read_pdf 的分层结构与执行流**
- 工具由三层组成：异步入口 `read_pdf` 先经 `_normalize_request` 把原始入参规整为 frozen dataclass `ReadPdfRequest`，再把同步的 `_read_pdf_sync`（pdfplumber 提取）通过 `asyncio.to_thread` 卸载到线程，避免阻塞事件循环。`_resolve_pdf_path` 负责路径边界：相对路径锚定在 Core 的当前主工作区（`get_workspace()`，获取不到则报错），并强制存在、是文件且后缀为 .pdf；
  - 路径校验先于 `import pdfplumber`，使依赖缺失环境下路径错误也能先呈现。运行中 Exception 被捕获并转为 `[ERROR]: read_pdf failed: ...` 字符串返回；缺失 `pdf_path` 时的 ValidationError 则按测试预期从 `read_pdf.invoke` 传播出去，不转为字符串。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L112–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L112-L130),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L257–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L257-L275),
  - [tests/unit_tests/agents/test_pdf_tools.py:L324–L335](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_pdf_tools.py#L324-L335)
- **read_pdf 的内部常量与入参规整**
- read_pdf 没有外部配置项，读取边界由模块级常量定义：`DEFAULT_MAX_CHARS = 50_000`（max_chars 缺省值）、`_MAX_CHARS_CEILING = 200_000`、`_MAX_PAGES_PER_CALL = 100`。`_normalize_request` 对 `max_chars` 做 `int()` 转换，仅当转换抛出 TypeError/ValueError（如 None 或 "abc"）时才回退默认值，可转换的输入（如 "2000"）会被采用；随后统一钳制到 `[1_000, 200_000]` 区间。
  - 工具描述通过 f-string 插值 `DEFAULT_MAX_CHARS` 与 `_MAX_PAGES_PER_CALL`（不含上限常量 `_MAX_CHARS_CEILING`），使模型可见的默认值与页数上限随常量自动同步。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L24–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L24-L26),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L112–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L112-L122),
  - [jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L244–L254](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/pdf_tools.py#L244-L254)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-pdf-reading-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L170-L183；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L213-L218
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L244-L254；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L1-L10
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L239-L262；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L36-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L273-L275；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L143-L168
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L185-L211；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L125-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L112-L130；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L257-L275
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_pdf_tools.py:L324-L335；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L24-L26
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/pdf_tools.py:L112-L122
- 源页字段（feature）：pdf-reading-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/pdf_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/pdf_tools.py
