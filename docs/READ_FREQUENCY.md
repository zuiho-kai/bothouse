# 记忆读取频率报告（#580）

`bothouse report file-frequency` 从本地记录里统计哪些文件被读得最多，按项目列出读取次数、最近一次读取和文件大小，并给出两条建议：

- **小且常读**：建议搬进 `<wiki>/STANDING.md` 的常驻做法块。
- **大且常读**：建议拆分。

这个命令**只读**：不修改 `STANDING.md`，不写记忆，也不改任何会话状态。

## 快速开始

~~~sh
# 最近 7 天，按项目输出 Markdown 表
bothouse report file-frequency --since 7d

# 只看 deep 项目，输出 JSON
bothouse report file-frequency --project deep --format json

# 没有 events.jsonl 时，直接读 Claude Code 会话记录
bothouse report file-frequency --source claudecode --since 30d

# Markdown 打到终端，同时把 JSON 写到文件
bothouse report file-frequency --since 7d --json-out /tmp/reads.json
~~~

默认数据目录与 bridge 相同（`~/.cc-connect-*/data`）；可用 `--data-dir` 指定。`--wiki` 默认取 `$GATE_WIKI`，未设置时用 `~/wiki`；传 `off` 可关闭 `STANDING.md` 预算段。

## 数据源

### 主数据源：events.jsonl（#581）

读取 `<data-dir>/events.jsonl`，存在轮转文件时先读 `events.jsonl.1`。只处理 `type` 为 `tool` 的事件：

~~~json
{"time":"2026-10-28T15:00:00+08:00","type":"tool","project":"deep","session_key":"discord:...","source":"bridge","text":"/Users/me/project/docs/a.md","data":{"tool":"Read"}}
~~~

- `data.tool` 是工具名，`text` 是工具入参的摘要。
- `Read` / `NotebookRead`：`text` 是文件路径，兼容 `file_path`、`path`、`notebook_path`、`file` 等 JSON 字段。
- `Bash` / `shell` / `execute`：`text` 是命令。当前识别 `cat`、`head`、`tail`、`less`、`more`、`bat`/`batcat`、`sed` 这些整文件读取命令；`grep`/`rg` 只做检索，不算读取。
- 写入类工具（`Write`/`Edit`/`Patch`）不计入读取。

#581 在写事件时把 `text` 截到 500 个字符，超长命令尾部的路径可能丢失；这是摘要流的已知边界。

### 备用数据源：Claude Code 会话记录

`--source claudecode` 读取 `~/.claude/projects/<project>/<session>.jsonl` 及其 `subagents/*.jsonl`，从 `message.content[]` 的 `tool_use` 块中取 `Read` 和 `Bash` 的入参。项目名用会话记录里的 `cwd`；没有 `cwd` 的记录归到 `(unknown)`。

`--source auto`（默认）先读 `events.jsonl`；如果窗口内没有任何 tool 事件，再回退到 Claude Code 记录。这样新部署和旧机器都能出报告。

## 建议阈值

所有阈值都是参数，下面的默认值都写了来源：

| 参数 | 默认值 | 来源 |
| --- | --- | --- |
| `--min-reads` | 2 | 本 PR 默认约定（#580 要求参数化）：单次打开是探索，至少重复读取 2 次才算“常读” |
| `--small-chars` | 1500 | `bridge/contrib/gate/ctxsvc.py` 的 `STANDING_CHARS=1500`（#574）；`STANDING.md` 上限 20 条 / 1500 字 |
| `--large-bytes` | 65536 | 本 PR 默认约定（#580 要求参数化）：按 4 B/token，64 KiB 约 1.6 万 token，常读时建议拆分 |
| `--top` | 15 | 沿用 open-strix `file_frequency_report.py` 的 `--top` 默认值 |

“建议进 `STANDING.md`”只说明该文件的字符数不超过常驻块上限（`--small-chars`），不代表当前块一定有空间。报告会读取 `<wiki>/STANDING.md` 并显示当前条数/字数/剩余字数；它不会替你删改。

## 输出

Markdown 每个项目一张表：文件、读取次数、最近读取、大小（小文件附字符数）、建议。

JSON 结构：

~~~json
{
  "generated_at": "2026-10-28T15:00:00+08:00",
  "source": "events",
  "window_start": "2026-10-21T15:00:00+08:00",
  "window_end": "2026-10-28T15:00:00+08:00",
  "event_count": 4,
  "thresholds": {
    "small_chars": 1500,
    "large_bytes": 65536,
    "min_reads": 2,
    "top": 15
  },
  "standing": {
    "path": "/Users/me/wiki/STANDING.md",
    "exists": true,
    "lines": 3,
    "chars": 220,
    "max_lines": 20,
    "max_chars": 1500,
    "remaining_chars": 1280
  },
  "projects": [
    {
      "project": "deep",
      "events": 4,
      "unique_files": 2,
      "files": [
        {
          "path": "/Users/me/project/large.md",
          "reads": 2,
          "last_read": "2026-10-28T15:00:00+08:00",
          "size_bytes": 70000,
          "size_known": true,
          "chars": 0,
          "chars_known": false,
          "suggestion": "split",
          "suggestion_text": "建议拆分"
        }
      ]
    }
  ]
}
~~~

字段说明：

- `suggestion` 是稳定代码：`standing`（进常驻块）或 `split`（拆分）；没有建议时省略。
- `size_known=false` 表示文件已不存在或不是普通文件；`chars_known=false` 表示文件大于 `4 × --small-chars` 字节，没必要为判断“小文件”而整读。
- `unique_files` 是该项目的全部文件数；`files` 只保留 `--top` 行。

## 限制

- `events.jsonl` 的 tool 事件没有 `cwd` 字段；相对路径按运行本命令时的工作目录解析，可能不准。工具入参通常是绝对路径，报告会原样保留。
- 只读取 `events.jsonl` 和一份轮转 `events.jsonl.1`；更早的轮转文件不在窗口内。
- Claude Code 备用源把 `cwd` 当项目名；同一文件在不同会话/子 agent 中读取会分别计数。
- 报告不判断文件内容是否值得常驻，只按大小和重复读取次数给建议；最终由人决定。

## 验证

~~~sh
cd bridge
go test -tags no_web ./core -run 'ReadFrequency|EventsReadSource|ClaudeCodeReadSource|ReadPaths'
go test -tags no_web ./cmd/cc-connect -run ReportFileFrequency
go build -tags no_web ./core ./cmd/cc-connect
~~~
