---
name: feature-depth-at-file-reference-inlining-b1a822e1
description: "@path 文件引用内联实现深读：pattern.sub 替换、resolve_at_file_references 签名与 max_file_size 默认值和截断、cwd 路径基准、OSError/UnicodeDecodeError 保留原文、内联体积取舍、test_at_file_references 单测"
metadata:
  scope: resolve_at_file_references 的流程、参数默认值、依赖、失败分支、取舍和单测断言；功能总览、@agent 提及解析和附件路径解析归 feature-at-file-reference-inlining-b1a822e1
---
# @path 文件引用内联与 @agent 提及解析：实现深读

## 现状

- [[feature-at-file-reference-inlining-b1a822e1]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **pattern.sub 对 content 中的 @path 匹配逐个替换为 file-content 包裹的文件文本** 对传入 content 执行 pattern.sub：每个匹配成功读取的文件被替换为 '\n<file-content path="{raw}">\n{text}\n</file-content>\n'；本切片未显示 pattern 构造与读取主体（2906 之前）。
- 来源：[jiuwenswarm/gateway/message_handler/message_handler.py:L2909–L2915](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L2909-L2915)
- **静态方法 resolve_at_file_references(content, cwd=None, max_file_size=_DEFAULT_INLINE_FILE_SIZE_LIMIT) -> str** Empty content returns as-is.
  - Matched non-agent @path/@"quoted" refs (after #L... suffix strip, ~/ expand, cwd/absolute resolution) that resolve to an existing file are replaced by a <file-content path=...> block;
  - only when max_file_size is None is the whole file read — otherwise reading is capped and oversized files get a truncation suffix. Non-files, OSError/UnicodeDecodeError, and raw values starting agent-/agent: keep the original match.
  - Caller supplies content and optionally cwd; default cwd is os.getcwd().
- 来源：[jiuwenswarm/gateway/message_handler/message_handler.py:L2846–L2871](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L2846-L2871),
  - [jiuwenswarm/gateway/message_handler/message_handler.py:L2873–L2915](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L2873-L2915)
- **max_file_size 默认 _DEFAULT_INLINE_FILE_SIZE_LIMIT；None 读全文，否则截断加尾注** 参数 max_file_size 默认值为模块常量 _DEFAULT_INLINE_FILE_SIZE_LIMIT（2850，具体数值未在所示片段中给出）。max_file_size 为 None 时整文件读取（2897-2898）；否则读取 max_file_size+1 字符并在超出时截断到 max_file_size，追加 '... (truncated, original_size=N bytes)' 尾注（2900-2908）。
  - 相对路径按 cwd（缺省 os.getcwd()，2866）拼接，~/ 前缀展开到用户主目录（2883-2889）。
- 来源：[jiuwenswarm/gateway/message_handler/message_handler.py:L2846–L2866](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L2846-L2866),
  - [jiuwenswarm/gateway/message_handler/message_handler.py:L2882–L2908](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L2882-L2908)
- **路径解析以调用方提供的 cwd 为基准（测试用 os.path.basename/dirname 构造）** 设计推断（非作者历史意图）：
- 测试把消息中的引用写成 basename，并把 cwd 设为 dirname，说明文件解析依赖调用方传入的工作目录而非固定根；这是从测试构造推断的耦合，实现在所提供的切片中不可见。
- 来源：[tests/unit_tests/gateway/test_at_file_references.py:L20–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_at_file_references.py#L20-L22)
- **文件读取触发 OSError 或 UnicodeDecodeError 时返回原始匹配串 m.group(0)，异常不外传** 读取文件的 try 块捕获 (OSError, UnicodeDecodeError) 后返回 m.group(0)，即该 @path 引用原文保留在 content 中，替换静默跳过；其他异常路径未在切片中显示。
- 来源：[jiuwenswarm/gateway/message_handler/message_handler.py:L2909–L2915](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L2909-L2915)
- **内联换取自包含，代价是消息体膨胀（依据测试文档字符串推断）** 设计推断（非作者历史意图）：
- 测试类文档字符串称 @path → <file-content> 内联：收益是代理无需文件系统访问即可看到内容；成本是文件内容进入消息文本，体积随文件增长。此为基于文档字符串与命名的推断。
- 来源：[tests/unit_tests/gateway/test_at_file_references.py:L9–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_at_file_references.py#L9-L13)
- **助手级单测：直接断言无 @ 输入原样返回** test_no_at_symbol_returns_unchanged 直接调用 MessageHandler.resolve_at_file_references 并断言返回 "hello world"；断言仅覆盖助手本身，非网关消息链路的运行时集成。内联与 strip 用例的断言行未在提供切片内。
- 来源：[tests/unit_tests/gateway/test_at_file_references.py:L177–L180](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_at_file_references.py#L177-L180)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-at-file-reference-inlining-b1a822e1.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L2909-L2915；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_at_file_references.py:L20-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_at_file_references.py:L9-L13；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_at_file_references.py:L177-L180
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L2846-L2866；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L2882-L2908
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L2846-L2871；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/message_handler/message_handler.py:L2873-L2915
- 源页字段（feature）：at-file-reference-inlining-b1a822e1
- 入口（entry_points）：jiuwenswarm/gateway/message_handler/message_handler.py
- 源页字段（source_globs）：jiuwenswarm/gateway/message_handler/message_handler.py
