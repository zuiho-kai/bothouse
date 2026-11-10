# InferMatrix 知识包（wiki packs）

这里放的是从 [InferMatrixLab/InferMatrixCopilot](https://github.com/InferMatrixLab/InferMatrixCopilot) 的 `knowledge/`
目录搬过来的经验页，已经改写成 bothouse wiki 的页面格式（frontmatter、现状 / 关键事实 / 决策与踩坑 / 待办 / 历史 五种小节、
页长和行长预算），每个子目录是一个可以直接放进 wiki 的「包」。

- 来源快照：InferMatrixCopilot 提交 `ecfb84d0`。只搬了一次，**没有后续同步**；源仓库之后的改动不会出现在这里，内容会逐渐过时。
- 只搬内容：页面按 wiki 格式重排、拆分，原文的事实、规则、命令、表格都保留，中英文混排照旧，没有翻译，也没有删减成摘要。
  InferMatrixCopilot 自己的检索、生命周期标记等机制没有搬。
- 本文件只是说明，不属于任何一个包；复制包的时候不要把它带进 wiki。

## 有哪些包

| 包 | 内容 | 适合放进 |
|---|---|---|
| `general/` | 跨仓库通用的做法：代码审查、调试、远端任务、规划、agent 协作、测试与 CI、性能测试、Bug 定级、文档验收 | 主 wiki |
| `afd-plugin/`、`jianghan-roleplay-data-pipeline/`、`vllm-gr/`、`vllm-omni/`、`jiuwenswarm/` | 各自仓库的规则、架构和踩坑记录（后续 PR 加入） | 负责该仓库的角色的 wiki |
| `skills/` | 不依赖 InferMatrixCopilot 的几个 skill（后续 PR 加入） | 按 skill 的用法安装 |

## 怎么用

1. 把包里的**领域目录**（`general/` 下的 `agents/`、`debug/`、`overview/`、`planning/`、`quality/`、`remote/`、`review/`）
   复制到目标 wiki 的根目录：`general` 进主 wiki，仓库包进负责那个仓库的角色的 wiki。
2. 把包里 `MEMORY.md` 的条目**追加**到 wiki 自己的 `MEMORY.md`，不要整个覆盖。wiki 最多 8 个领域，
   放不下时先把包里的目录并到已有领域下面（在那个领域的 `README.md` 里加一行子目录链接）。
3. 页面文件名在一本 wiki 里必须唯一（`[[页面名]]` 靠文件名解析），和已有页面重名的要先改名。
4. 跑一遍体检，确认没有报错：`python3 -I <wiki>/bin/lint.py`
   （或 `python3 -I bridge/contrib/wiki/llmwiki/lint.py --root <wiki 目录>`）。

每一级目录都带 `README.md` 索引，`bridge/contrib/gate/wiki_search.py` 只检索这样的目录，所以复制时要把 `README.md` 一起带上。

## MANIFEST.tsv 是什么

每个包根目录有一份 `MANIFEST.tsv`：源目录里每个文件一行，写明源路径、源页类型、改写后的目标页（一页拆成多页时用 `;` 分开），
以及该页带的规则编号。源索引页（`_index.md`）里只有链接列表的标 `regenerated-index`，由 `README.md` 代替；
带有说明文字的改写成 `*-overview.md`。它只是对照表，用来核对有没有漏页，不需要复制进 wiki。

## 放进 wiki 之后

包一旦进了正在使用的 wiki，bothouse 的自动整理（会话后的 ingest、夜间补漏和每周体检）会像对待其他页面一样
合并、拆分或改写这些页，之后的内容就不再和这里的快照、`MANIFEST.tsv` 一一对应。

## English

One-off snapshot of the `knowledge/` tree of InferMatrixLab/InferMatrixCopilot at commit `ecfb84d0`, rewritten into
bothouse wiki page format. Content only; there is no ongoing sync, so the packs will go stale.

- Packs: `general` (cross-repo practices, for the main wiki) is here now; five repo packs (`afd-plugin`,
  `jianghan-roleplay-data-pipeline`, `vllm-gr`, `vllm-omni`, `jiuwenswarm`, each for the wiki of a role working on that
  repo) and `skills/` follow in later PRs.
- Use: copy a pack's domain directories into the wiki root, append the pack's `MEMORY.md` entries to the wiki's own
  `MEMORY.md` (do not overwrite it; a wiki holds at most 8 domains), then run the wiki lint.
- `MANIFEST.tsv` maps every source file to its target page(s) and rule IDs; it is a cross-check table and is not copied.
- Once a pack is in a live wiki, bothouse's automatic passes (ingest, nightly, weekly lint) may merge, split or rewrite
  its pages. This README is not part of any pack.
