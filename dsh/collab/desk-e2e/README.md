# 团队工作台端到端驱动（Issue #876 E 路）

一套「真事件、真插件、真浏览器」的端到端驱动：在隔离的临时目录里用真实 `board.py` 造派活/交回/退回/暂停事件，
起协作插件，用 Playwright 打开 `/collab/desk` 截图，再用回放模式录 15 秒视频。桌面与手机两种视口各一份。

它不造假光柱：页面上出现的每一道光，背后都是 `board-events.jsonl` 里的一行真实事件。

## 隔离

跑一次会拉起 `board.py` 与插件，两者都可能读写产品目录、调桥的命令。为了不碰线上，子进程环境被整体换掉：

| 变量 | 指向 | 为什么 |
| --- | --- | --- |
| `HOME` | `<临时>/home` | 逼开 `datadir` 的线上目录探测，也让任何按家目录找配置的逻辑落空 |
| `BOTHOUSE_DATA_DIR` | `<临时>/bothouse` | `lead.json` 等产品数据 |
| `GATE_SETUP_DIR` | `<临时>/gate` | gate 的配置与任务板根 |
| `BOARD_DIR` | `<临时>/board` | 本轮 `board.jsonl` 与 `board-events.jsonl` |
| `CC_BIN` | `<临时>/fake-cc.sh` | 假桥：`pause`/`done` 里的定时器与工作区命令全部落空，不碰真桥 |
| `CC_DATA_DIR` | 空 | 连同上面的家目录一起，确保不会回落到线上数据目录 |
| `CC_SESSION_KEY` | 空 | 不绑任何真实会话 |

另外 `CONEST_COLLAB_DATA`（插件 `dataDir`）与 `leadFile` 也都指向同一个临时目录。

**脚本不删任何东西**：产物与临时数据都留着，末尾打印两个路径，方便手查 `board.jsonl` 与 `board-events.jsonl`。

## 前置

| 需要 | 说明 |
| --- | --- |
| DSH 运行时 | 插件用 `createRequire(process.argv[1])` 解析 `ws` 与 `@deepseek-ai/dsh-llm`；脚本从 `which dsh` 找安装位置，`DSH_CLI` / `DSH_REQUIRE_BASE` 可覆盖 |
| collab 依赖 | `cd dsh/collab && pnpm install --frozen-lockfile`（插件导入 `@agentclientprotocol/sdk`） |
| Playwright | 只在要看画面时需要：`npm i -D playwright && npx playwright install chromium`。装在别处时用 `PW_MODULE` 指向它的入口（如 `PW_MODULE=/abs/node_modules/playwright/index.mjs`），浏览器目录用官方的 `PLAYWRIGHT_BROWSERS_PATH` |

## 跑

```sh
# 全跑；产物落在临时 out/，路径在末尾打印
node dsh/collab/desk-e2e/run.mjs

# 产物放到指定目录
node dsh/collab/desk-e2e/run.mjs --out ./out
```

退出码：有任何 FAIL 时为 1；全 PASS 或只剩 SKIP 时为 0。

## 延迟量测（T 路）

同一套临时环境与宿主，但只量「真派活到页面出光」的时间：

```sh
node dsh/collab/desk-e2e/latency.mjs [--out ./out]
```

真跑 `add → returned → reject → returned → done`，桌面与手机各一遍，每步给出「命令耗时」与「从命令开始到对应光柱出现」的毫秒数，并核对光柱真的画出了曲线（SVG 路径条数与包围盒）。门槛 5 秒，超出或漏光退出码为 1。开着测之前会先静止 2 秒做对照，确认页面不会自己冒光。

## 它检查什么

| 步 | 检查 | 不满足时 |
| --- | --- | --- |
| 1 | 真实 `board.py` 的 add / update / returned / reject / pause / done 是否各写一行 `board-events.jsonl`；`kind` 是否齐全，`ts/id/from/to/title` 是否完整 | FAIL：文件缺失、kind 缺失或字段不全 |
| 2 | 最小宿主起插件；`/collab/desk` 必须是 200 的 HTML；`/collab/api/state` 返回成员 | FAIL：路由缺失或返回的不是页面 |
| 3 | 先等到 SSE 的 `: connected` 首帧再写一条真实事件，15 秒内必须收到 `type=task` | FAIL：超时或帧不完整 |
| 4 | Playwright：实时态桌面 1440×900、手机 390×844 各一张截图；录制中由 cj（C酱）派给 肥鱼、交回、打回，桌面和手机各造一条自己的样片任务，实时录 15 秒并分别核对派活/交回/退回三道光（`#beams .beam.assign` / `.return` / `.reject`）；同时检查事件归一后派活人与接活人不是同一成员 | 没装 Playwright 记 SKIP；页面还是占位页或骨架（无地图 / 有 `__JS_LIVE__` 占位）记 SKIP，不产假样片；页面就绪但光柱没画出、或派活人与接活人归一成同一人记 FAIL |

第 2、3 步是硬门槛：B 路已经在 `develop` 里，路由或事件流不通就是真问题，不再降级成 SKIP。

## 边界

- 不连桥、不发消息、不部署、不改线上配置。
- 事件用 `CC_PROJECT=deep` 造 `from`，`who` 造 `to`，与真实派活的写法一致。
- 录屏以实时态为主：桌面和手机各造一条样片任务，由 cj 派给 肥鱼、再交回、再打回，三道光对应三条真实事件。脚本分别数 `.beam.assign` / `.beam.return` / `.beam.reject`，并检查事件归一后派活人与接活人不是同一个成员——自己派给自己，页面不画光。
- 回放样片只在页面把回放控件接好后才录；现有 C 路页面还是骨架时，脚本明确跳过画面阶段，不拿静止画面冒充样片。
- 画面对的是 C 路提供的页面；C 未合入时是 B 的占位页（只有事件列表），页面还是骨架（`__JS_LIVE__` 占位没填）时，第 4 步明确记 SKIP 并说明原因，不产假样片。

## 测试

`dsh/collab/desk-e2e.test.mjs` 是入口：有 DSH 运行时、A 路事件写入与 collab 依赖时跑上面的全流程，否则整条跳过并写明原因（CI 没有 DSH，不会因此变红）。