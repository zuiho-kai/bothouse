# bothouse-dsh

[English](README.en.md)

把 BotHouse 的「频道」装进 DeepSeek Harness（DSH）：Discord 式的频道页，DSH 里的模型和本机的 Claude Code、Codex、Gemini 都能当频道成员，@ 谁谁干活。

插件只管频道这一层；每个成员由 BotHouse 来跑，派活、工作区、任务板、定时回查、记忆和团队规矩都用 BotHouse 那一份。本机没有 BotHouse 时，插件第一次启动会用官方安装脚本把它装进 `~/.local/bin` 并在后台拉起，不用另外装。

## 安装（三选一）

1. **最省事**：在 DSH 里对它说「帮我装插件 bothouse-dsh」。
2. **点界面**：DSH 侧栏「插件」→「添加插件」，填 `bothouse-dsh`，点「安装」；装完在「已安装插件」里把 bothouse 的开关打开，左侧马上出现「频道」，不用重启。
3. **命令行**：

~~~sh
dsh plugin --profile web add bothouse-dsh
~~~

不用写版本号。DSH 用 pnpm 装插件，pnpm 默认跳过发布不满一天的版本，所以刚发版时可能先装到上一版；插件启动后会自己对一下 npm 上的最新版，落后就自动更新过去（频道里会说一句「已更新到 x.y.z」），并把 bothouse-dsh 记进这个 profile 的 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`，以后再装直接是最新版。连不上 npm 时跳过，不影响使用。

对 DSH 说的装法装完左侧直接出现「频道」；命令行装时 DSH 若正开着，重启一次。然后点左侧「频道」。团队工作台、bothouse 面板、其他电脑默认不在左侧，要用就到「插件 → bothouse」里打开对应那一项，左侧马上出现。#general 里已经有成员：一个「DSH」，用的是你在 DSH 里配好的那个模型；本机装了 Claude Code、Codex、Gemini 的，各自也自动加一个，头像就是对应软件的图标，不用再填任何东西。@DSH 就回话；对它说「交给工作区做：……」，它会开工作区干完再交回。人设、名字、头像想改，点成员编辑。

命令行装时提示 `pnpm was not found`：先 `npm i -g pnpm` 再装。

## 需要什么

- DSH 0.2.x（`0.2.1-rc.2` 起，`dsh --version`）和 Node.js 22.12 以上。只在 0.2.1-rc.2 上实测过；DSH 插件接口有没有兼容承诺没查到，页面又是按 DSH 0.2 的前端包预编译的，所以先只放到 0.2.x，0.3 出来要重新验。
- 用模型当成员：在 DSH 设置里先配好模型和 Key。
- 用 CLI 当成员：本机装好并登录 Claude Code、Codex 或 Gemini CLI，命令在 PATH 里。
  Claude Code 成员的编辑窗可填写模型 ID 或别名，留空跟随 CLI 默认模型；保存后下一轮生效。
  派活：在频道里 @ 成员，或让一个成员 @ 另一个成员，被派的成员做完把结果发回频道。
- 第一次启动要能连上 GitHub（下载 BotHouse，约 40 MB）。之后添加、修改、删除成员，插件都交给 BotHouse 更新它的角色；BotHouse 的日志在频道数据目录的 `bothouse.log`。
- 频道消息存在 `~/.conest-collab/collab.sqlite3`；启动 DSH 前设置 `CONEST_COLLAB_DATA` 可换目录。

## 和完整版 BotHouse 的区别

插件版以频道为主（团队工作台、面板、其他电脑可在插件页打开），成员背后跑的就是 BotHouse。直接用 BotHouse 另外提供：

- 安装向导：可以选角色、选每个角色用哪个本机 CLI。插件版第一次启动自动加一个 DSH 成员，再给本机找到的每个 CLI 各加一个，其余要自己点「添加成员」。
- 代存 Key：向导替你把 DeepSeek Key 写进 DSH。插件版在 DSH 设置里自己填。
- 外部 bot：通过 cc-connect 把 Discord、飞书等外部 bot 接进频道。

## 开发

~~~sh
cd dsh/plugin-pkg
npm run pack   # 复制 ../collab，预编译 ../packages/client-ui-discord，打出 bothouse-dsh-<版本>.tgz
dsh plugin --profile web add ./bothouse-dsh-0.1.0.tgz
~~~
