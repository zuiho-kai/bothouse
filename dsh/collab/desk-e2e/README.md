# 团队工作台端到端驱动（Issue #876 E 路）

一套「真事件、真插件、真浏览器」的端到端驱动：在临时目录里用真实 `board.py` 造派活/交回/退回/暂停事件，
起协作插件，用 Playwright 打开 `/collab/desk`，截图并录一段 15 秒视频。桌面与手机两种视口各一份。

它不造假光柱：页面上出现的每一道光，背后都是 `board-events.jsonl` 里的一行真实事件。

## 前置

| 需要 | 说明 |
| --- | --- |
| DSH 运行时 | 插件用 `createRequire(process.argv[1])` 解析 `ws` 与 `@deepseek-ai/dsh-llm`；本脚本从 `which dsh` 找到安装位置，用 `DSH_CLI` / `DSH_REQUIRE_BASE` 可覆盖 |
| collab 依赖 | `cd dsh/collab && pnpm install --frozen-lockfile`（导入 `@agentclientprotocol/sdk`） |
| Playwright | 只在要看画面时需要：`npm i -D playwright && npx playwright install chromium`；浏览器装在自定义路径时加 `PLAYWRIGHT_BROWSERS_PATH=<路径>` |

## 跑

```sh
# 全跑（截图/录屏落在临时目录，末尾打印路径）
node dsh/collab/desk-e2e/run.mjs

# 产物放到指定目录
node dsh/collab/desk-e2e/run.mjs --out ./out

# 保留临时数据目录，方便手查 board.jsonl 与 board-events.jsonl
node dsh/collab/desk-e2e/run.mjs --keep

# B/C 还没合、只想先验截图录屏这段管道：拿现有频道页当靶子
DESK_E2E_PAGE=/collab node dsh/collab/desk-e2e/run.mjs
```

## 它检查什么

按依赖顺序四步，缺哪步就停在哪步并说清缺什么：

| 步 | 检查 | 缺什么时 |
| --- | --- | --- |
| 1 | 真实 `board.py` 的 add / update / returned / reject / pause / done 是否往 `board-events.jsonl` 各写一行，`kind` 是否齐全、`ts/id/from/to/title` 是否完整（A 路） | 报 FAIL：文件不存在或字段不全 |
| 2 | 最小宿主起插件；`/collab/desk` 是否 200 且是 HTML（B/C 路）；`/collab/api/state` 是否返回成员 | 报 SKIP：B/C 未合入时属预期 |
| 3 | 订阅 `/collab/api/events`，造一条新事件，看 15 秒内有没有 `type=task` 转发（B 路） | 报 SKIP：B 未合入 |
| 4 | Playwright 打开页面，桌面 1440×900、手机 390×844 各截图，各录 15 秒（含「静默 2 秒 → 造事件 → 看飞光」） | 报 SKIP：没装 Playwright 或第 2 步没过 |

退出码：有任何 FAIL 时为 1；全 PASS 或只剩 SKIP 时为 0。

## 边界

- 全部数据在 `mktemp` 目录：`CONEST_COLLAB_DATA`（插件 `dataDir`）、`BOARD_DIR`、`leadFile` 都指到那里，不碰线上的任务板、频道库与 `lead.json`。
- 不连桥、不发消息、不部署、不改线上配置。
- 事件用 `CC_PROJECT=deep` 造 `from`，`who` 造 `to`，与真实派活的写法一致。
- 画面步只在 `/collab/desk` 已经是真页面时才有意义；C 路合入前 B 给的是占位页（只列事件，不画地图）。

## 测试

`dsh/collab/desk-e2e.test.mjs` 是入口：有 DSH 运行时且 A 路已合入时跑上面的全流程，否则整条跳过并写明原因（CI 没有 DSH，不会因此变红）。