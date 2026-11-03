# 频道页消息渲染样张（#114 渲染路）

白底浅色、思考一行灰字可折叠、工具事件居中灰色小行——**能点的**样张，不是截图。
`index.html` 是构建产物，单个文件双击就能开，不发任何外部请求。

## 打开

```
open index.html          # 直接开这一个文件（file:// 即可）
```

放 Artifact 或任意静态托管时，只发 `index.html` 一个文件也成立：图片和文件附件是构建期
内嵌的演示素材，运行时换成 `blob:` 网址。

## 目录

| 文件 | 作用 |
| --- | --- |
| `build.mjs` | 从 `../../page.html` **按源码边界原样抽取**渲染代码、正文更新逻辑、CSS 与设计令牌，拼上 `shell.html` 生成 `index.html` |
| `shell.html` | 样张外壳：造数据、按钮、当场量结果。**不含**任何渲染实现 |
| `index.html` | 构建产物（单文件，可携带） |
| `check.mjs` | 机器判定：file:// 打开，跑五个回归场景，任一项不对就以非 0 退出 |
| `verify.mjs` | 逐按钮实测并截图/录屏，结果写 `verify.json`（`URL=http://…` 可跑在静态端口上） |
| `assets/` | 演示附件素材（构建时内嵌） |
| `shots/` | 桌面/手机、亮/暗截图与一段操作录屏 |

## 抽的是产品里的哪几段

构建时按下面的注释边界切片，找不到直接报错、拒绝生成（不会静默降级成「另写一套」）：

| 抽出来的东西 | page.html 里的边界 |
| --- | --- |
| 设计令牌（亮色只覆盖颜色） | `:root` 与亮色 `@media` |
| 消息行 / 任务卡 / 正文渲染样式 | `#log {` → `/* 任务卡` → `/* ---- 消息正文 Markdown` → `</style>` |
| Markdown、附件列表、引用跳转 | `// ---- 消息正文渲染 ----` → `// 贴底跟随` |
| 贴底判定与跟随 | `// 贴底跟随` → `const messageSig` |
| 单条消息组装、思考/工具行 | `const messageSig` → `// 同一人连续发言` |
| 连续发言归组、正文原地更新、写入 | `// 同一人连续发言` → `async function api` |

样张只做三处薄适配，都在外壳里：`state.room` 给一个演示房间号、`pushMessage()` 在
产品 `upsert()` 之后更新「回到最新」未读数、插入后把附件网址换成本地 `blob:`。
产品渲染函数一个字没改。

## 复现

```
node build.mjs                       # 重新生成 index.html
node check.mjs                       # 五个回归场景，file://，12 项全绿才算过
node verify.mjs                      # 逐按钮实测 + 截图/录屏，写 verify.json
URL=http://127.0.0.1:49343/ node verify.mjs   # 同上，但剪贴板可读（file:// 下浏览器不许读剪贴板）
```

`check.mjs` 支持对照「修复前」的页面源码，用来确认判定本身能判错：

```
git show <修复前提交>:dsh/collab/page.html > /tmp/before-page.html
node build.mjs /tmp/before-page.html /tmp/before-index.html
node check.mjs /tmp/before-index.html    # 应当失败
```

## 这一轮修的两个验收缺口

1. **正文原地更新改成按块复用**（`patchBody`）。此前整段正文 `replaceChildren`，已经存在的
   代码块被扔掉重建，横向滚动位置清零、点过的「复制」状态丢失。现在内容没变的块留用原节点，
   代码块长高时只换里面的字并保住 `scrollLeft`。
   - 修复前：`sameRow=true, sameCodeBlock=false, scrollLeft 100→0`
   - 修复后：`sameRow=true, sameCodeBlock=true, scrollLeft 100→100`
2. **样张不再自己写 upsert**：`shell.html` 里那份 `existing.replaceWith` 已删除，改用从产品页抽出来的
   `regroup` / `patchBody` / `upsert` / `followBottom`，所以「流式时整行有没有被重建」量的是产品行为。

## 量到的数（`verify.json`，桌面 1440×900 / 手机 390）

| 项 | 结果 |
| --- | --- |
| 长消息 | 26 段，插入后仍贴底 |
| 代码块 | 2 块，自身横滚 2408 / 视口 720，复制按钮回「已复制」，剪贴板 453 字 |
| 表格 | 4 列 4 行；手机宽 350 时内部横滚 350/262，整页不横滚 |
| 图片 / 附件 | 图片 2088×1294 加载完成，文件卡显示名称与大小，贴底读者未被顶走 |
| 引用回复 | 引用条出现，点一下跳到原消息并高亮 |
| 流式输出 | 103 字写进同一条消息，整行未被重建，贴底误差 0px |
| 思考（折叠一行） | 默认折叠（展开体 0 高），点开 61px |
| 工具事件 | 3 行、居中、12px 灰字，失败行标红 |
| 贴底与历史阅读 | 往上翻时新消息不拽视野；「回到最新」显示 12 条，点回 gap 0 |

## 边界

- 附件是**演示 fixture**：图片和 PDF 在构建时内嵌进 `index.html`，运行时换成 `blob:` 网址。
  这只证明「单文件打开时图能显示、文件能下载」，**不是**后端 `/collab/api/attachments` 的实测。
- `file://` 下浏览器不允许读剪贴板，所以那一轮 `verify-file.json` 里 `copy.clipChars` 是错误串；
  复制按钮本身（回「已复制」、写入成功）照常量。要连剪贴板一起验就走 `URL=http://…`。
- 布局仍以布局路为准，本样张只负责渲染、流式与附件展示。
