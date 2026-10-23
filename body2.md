## 改了什么

每个角色每次投递都会带上 `dsh/collab/team-mode-rules.md` 的公共段（`bridge/core/team_mode.go:84` `withTeamModeRules`），这份文件同时用作新工作区的开工说明。所以把协作约定写进公共段就能覆盖「新装即默认知道」，不必改 24 份人设文本。

新增三条：

1. **首行四种表态**：`【接】` 能做直接开工、`【问】` 列出缺的几点、`【退】` 说明谁更合适、`【升】` 交给派活的人拍板；后面可跟 `#任务号`。解析侧原本就有（`dsh/collab/tasks.mjs:28` `STANCE_LINE`、`:155` `stance()`、`:229` 从回复首行取表态）。
2. **怎么叫队友**：见下方复审返工，最终按 `mentions.go` / `mentions.mjs` 的实际判定写。
3. **催办无需自己挂计时**：走任务分发派的活，系统在 `next_check_at` 到点时提醒一次负责人（`dsh/collab/tasks.mjs:25` `CHECK_AFTER_S = 10*60`，`assign()` 里写入）。措辞限定为任务分发——任务分发目前只有 DSH 有，没有写成所有平台都自动。

另加一句：派活前先看队友状态，对方有进行中的活就换人或等一等。

## 复审返工（bca937d → 913523b）

**必改 1：规则与 DSH 代码矛盾。** `dsh/collab/mentions.mjs` 的 `called()` 原来对行内任意位置的名字都判，名字后跟呼语标点就算叫到人（「行了龙娘，」也触发）。已按 `bridge/platform/discord/mentions.go` 的 `nameCalled` 重写为**只认行首**：名字必须在行首（一行可以连写几个名字，如「龙娘、橘，…」「橘和龙娘 …」），随后由 `callFollows` 判定（行尾、空格、呼语标点，或「你/帮/来/看/快/给/过来/出来/有空」这类叫人词）。镜像同步。

**必改 2：行首叫法写窄了。** 规则原文只写「名字后面紧跟逗号或问号」。已照 `mentions.go` 的 `callFollows` / `callWords` 写实：行首名字后面跟标点、空格、换行，或直接跟叫人词都算叫；一行写一串名字会叫上这一串；不想叫就别把名字放行首。

## 验证

- `node --test *.test.mjs` → tests 76 / pass 76 / fail 0
- 新增断言：「行了橘，你来」不算叫；「橘，你来」「橘 你看下」「橘」「橘你来」「橘、龙娘，一起看」「橘和龙娘 都来」算叫；「橘子和苹果」不算。
- `go test -tags no_web ./core -run 'TestTeamModeRules|TestTeamModeWorkspace|TestCuj|TestMention'` → ok
- 新增 `TestTeamModeRulesCarryCollaborationConventions`：solo/team/mixed 三档都含四种表态、叫法、催办措辞，并断言文本不出现「每个平台」「所有平台」。
- `team-mode-rules.md`、`mentions.mjs`、`collab.test.mjs` 三个镜像与源文件 `diff` 无输出。
- `iso-check before` / `after`：after 干净。

## 没验的

- `go build ./...` 在本副本报 `web/embed.go: pattern all:dist: no matching files found`，前端 dist 未构建所致；本次未改 Go 源码（只加了测试）。
- 真实 Channels 页面截图未跑：本改动只影响提示词文本与名字判定，按安排合进主线后在真实频道验收首行表态。

## 说明

无新增开关、参数或用户可见设定；未动 24 份人设文本；未发版。
