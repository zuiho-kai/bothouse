---
name: feature-rsi-dataset-folder-check
description: RSI 数据集任务文件夹预检 check_folder.py：调用契约与退出码、scorecard 13 键与数值门槛、artifact_path 与 seed 规模一致性、traceback 警告、scorecard.json 缺失时的未捕获异常
metadata:
  scope: 只收 check_folder.py 的功能概览（入口契约、被校验配置与阈值、验证入口、取舍边界、支持的检查行为）；实现深读归 feature-depth-rsi-dataset-folder-check
---
# RSI 数据集任务文件夹完整性预检 check_folder.py

## 现状

- **入口与调用契约**
- 命令行入口：`python scripts/check_folder.py <task-folder>`，恰好接收一个参数，否则打印模块 docstring 并返回 1。正常执行路径下，检测通过时输出 `ok: <root> is complete` 并返回 0；检测发现问题时把 problems 逐行输出并返回 1，warnings 仅额外打印、不影响退出码。
  - 注意契约前提：`run/scorecard.json` 在 L73 被直接 `read_text()` + `json.loads()`，此时 problems 尚未初始化，文件缺失（FileNotFoundError）或 JSON 无效会抛出未捕获异常，脚本以非零状态崩溃而非干净地返回 1；退出码契约仅在正常执行至 L214 时成立。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L67–L83
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L67-L83`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L210–L218
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L210-L218`）
- **被校验的配置项与阈值**
- scorecard 顶层允许恰好 13 个键（statement、script、hash、entrypoint、evaluator_file、evaluator_command、packages、reply_format、iterations、workers、max_tokens_per_call、options、scorecard），缺失或多余的键都记为问题；options 子树只检查 7 个键（c_puct、prior_exponent、repair_attempts、completion_timeout、mode、staleness、async_ratio）是否缺失。
  - 数值硬门槛：`gateShards >= 4`、`rolloutShards <= gateShards`、`iterations >= 4*workers`、`max_tokens_per_call >= 32000`。workers>1 且 mode=serial 同样计入 problems（使退出码为 1），报错文案解释这会让运行警告后串行化、浪费 worker；workers==1 时要求 mode 为 serial。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L22–L45
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L22-L45`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L151–L159
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L151-L159`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L161–L178
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L161-L178`）
- **验证入口**
- 所示片段中脚本自身的验证入口就是它的命令行执行：`python scripts/check_folder.py <task-folder>`，通过/失败以退出码 0/1 体现，问题与 `ok:` 消息经 logging 输出到 stdout（L20 配置 INFO 级、stdout 流）。它覆盖的检查面即上文各条规则（键集、seed 清单、artifact_path、数值下限、脚本文本比对等）。
  - 风险点：`run/scorecard.json` 缺失时 `read_text()` 在 `json.loads()` 之前就抛出 FileNotFoundError（L73），未捕获，脚本以 traceback 崩溃；这属于未处理的失败路径，而非干净的错误报告。所示证据中没有该脚本的单测或其他测试入口。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L2–L8
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L2-L8`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L19–L20
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L19-L20`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L67–L83
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L67-L83`）
- **取舍与边界**
- Inference / 设计推断（非作者历史意图）：
- 脚本明确限定为静态预检：不导入 seed、不运行 evaluator（L6–L8 docstring 自述），因此所有门槛都是形状/数值层面的，运行时行为只能以 warnings 形式"smell"——注释 L195–L196 说明探针会拒绝 error 中不含位置的文件夹，但该行为本身无法在此测试，只以警告提示补 traceback。区分两级严重度：键集/数值/一致性违规记入 problems 并返回 1，而 traceback 启发式仅打警告不动退出码（L197–L214）。
  - 推断（inference）：这条 traceback 规则被降为警告而非问题，可能因为它是启发式判断而非确定性契约违约，但代码与注释均未给出理由。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L2–L8
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L2-L8`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L195–L214
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L195-L214`）
- **支持的检查行为**
- 除键集与数值下限外，脚本实现了跨文件一致性检查：`artifact_path` 必须按 seed 规模取值——单文件 seed 指向 `seed/<entrypoint>`，多文件树则必须是 `seed` 本身，注释说明 provider 只加载 artifact_path 名下的内容（L115–L125）；`prompts/mutation.md` 若存在则必须包含 `${reply_format}` 占位符（L186–L188）。
  - 另一特性是启发式警告通道：当 Python evaluator 的 script 含 `except` 却不含 `traceback` 时，仅发出警告而非记入 problems；注释明确这是脚本无法测试的运行时"smell"——探针运行的受损副本若抛异常且 `error` 报告不含位置信息，该文件夹才会被拒（PROBE_REFUSED），退出码不受 warnings 影响（L195–L214）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L115–L125
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L115-L125`）,
  - jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L195–L214
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py#L195-L214`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-rsi-dataset-folder-check.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L67-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L210-L218
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L22-L45
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L151-L159
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L161-L178
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L2-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L19-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L195-L214
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py:L115-L125
- 源页字段（feature）：rsi-dataset-folder-check
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/rsi-program-dataset-creator/scripts/check_folder.py
