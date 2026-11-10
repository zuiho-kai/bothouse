---
name: feature-depth-xlsx-formula-check
description: formula_check.py 实现深读：_scan 两遍读取与 issue 类型、main 的 CLI 契约、ERROR_TOKENS 硬编码、openpyxl 导入失败 sys.exit(2)、缓存值过期取舍、SKILL.md 手工命令（未执行）
metadata:
  scope: 收 formula_check.py 的实现细节（_scan、CLI、令牌表、导入失败、缓存取舍、手工验证记载），来源另含 SKILL.md；功能概览归 feature-xlsx-formula-check
---
# XLSX 公式静态校验（formula_check.py）：实现深读

## 现状

- [[feature-xlsx-formula-check]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **_scan 两遍读取工作簿并汇总 issue 列表** _scan(path) 先以 data_only=True 只读加载工作簿，遍历所有工作表单元格，缓存值为字符串且包含任一 ERROR_TOKENS 时记录 {sheet, cell, type:"cached_error", detail}；再以 data_only=False 只读加载一遍，对以 "=" 开头的公式文本做同样的 token 匹配并记录 type:"formula_error"，最后返回 issue 列表。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L27–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L27-L57)
- **main 的 CLI 契约：位置参数 file，--json/--report 布尔旗标，返回 0/1** main() 用 argparse 接受一个位置参数 file 和 --json、--report 两个 store_true 旗标，返回 0（无 issue）或 1（有 issue）；--json 时输出 {"ok":bool,"issues":[...]} 的缩进 JSON，否则打印 "OK: ..." 或逐条 "[type] sheet!cell -> detail" 文本。调用方需自行传入可被 openpyxl 加载的 xlsx 路径。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L60–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L60-L79)
- **错误 token 列表硬编码，CLI 两个开关默认关闭，默认文本输出（在已展示的 argparse 解析器内）** ERROR_TOKENS（#REF!、#DIV/0!、#VALUE!、#N/A、#NAME?、#NULL!、#NUM!）硬编码于 L24，所示解析器中没有覆盖它们的选项。--json 与 --report 为 store_true，默认 false；未传 --json 时输出人读文本（L69–L78）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L24–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L24-L24),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L61–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L61-L71)
- **仅依赖 openpyxl，导入失败即打印并 sys.exit(2)** 脚本在模块顶层 try 导入 openpyxl 的 load_workbook 与 get_column_letter，任何异常都会向 stderr 打印 "openpyxl is required: ..." 并 sys.exit(2)；get_column_letter 用于把列号转成字母拼出单元格地址。不依赖其他第三方库。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L17–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L17-L22),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L38–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L38-L40)
- **openpyxl 导入失败时打印 stderr 并 sys.exit(2)；发现问题时 main 返回 1 并经 sys.exit(main()) 传播为进程退出码** L17–L22 捕获导入 Exception，向 stderr 打印 "openpyxl is required: ..." 并 sys.exit(2)。L67–L79 中 issues 非空时 main 返回 1，L82–L83 的 __main__ 块以 sys.exit(main()) 将该返回值作为进程退出码。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L17–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L17-L22),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L67–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L67-L79),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L82–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L82-L83)
- **只读静态扫描便宜但可能基于过期缓存值** 设计推断（非作者历史意图）：
- （推断）收益：read_only=True 两遍加载 + 纯字符串 token 匹配，避免执行公式的开销与副作用；代价：docstring 明言不执行公式，cached_error 检查的是文件中缓存的值，若缓存过期则结果过期——需先运行 libreoffice_recalc.py 才能得到新鲜值。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L9–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L9-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L30–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L30-L30)
- **已记录的手动静态校验命令与退出码判定（未执行）** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md 记录的手动流程：`formula_check.py file.xlsx --report`，以退出码 0 判定为未发现问题；docstring 约定 0=无错误、1=发现问题、2=用法错误，且 main 中以 `return 0 if ok else 1`（L79）对应。脚本只做静态扫描、不执行公式，需要新鲜缓存值时须先运行 libreoffice_recalc.py。以上步骤在本条目中明确未执行（NOT EXECUTED）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L169–L172](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md#L169-L172),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L3–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L3-L11),
  - [jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L67–L79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py#L67-L79)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-xlsx-formula-check.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L27-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L60-L79
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L17-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L38-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L9-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L30-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L24-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L61-L71
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L67-L79
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L82-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/SKILL.md:L169-L172
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py:L3-L11
- 源页字段（feature）：xlsx-formula-check
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/xlsx/scripts/formula_check.py
