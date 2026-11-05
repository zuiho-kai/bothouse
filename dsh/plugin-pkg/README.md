# bothouse-dsh

[English](README.en.md)

把 BotHouse 的「频道」装进 DeepSeek Harness（DSH）：Discord 式的频道页，DSH 里的模型和本机的 Claude Code、Codex、Gemini 都能当频道成员，@ 谁谁干活。

## 安装（三选一）

1. **最省事**：在 DSH 里对它说「帮我装插件 bothouse-dsh，按 npm 上的最新版本号装」。
2. **点界面**：DSH 侧栏「插件」→「添加插件」，填 `bothouse-dsh@<npm 上的最新版本号>`。
3. **命令行**：

~~~sh
dsh plugin --profile web add "bothouse-dsh@$(npm view bothouse-dsh version)"
~~~

装完重启一次 DSH，点左侧「频道」。#general 里已经有鲸鱼娘，用的是你在 DSH 里配好的那个模型，不用再填任何东西。@鲸鱼娘 就回话；对她说「交给工作区做：……」，她会开工作区干完再交回。想要多角色、多模型，再点「添加成员」。

要带版本号：DSH 用 pnpm 装插件，pnpm 会暂缓刚发布的版本，只写 `bothouse-dsh` 或 `bothouse-dsh@latest` 会装到几天前的旧版；写明版本号时 pnpm 自动放行，装到最新。

命令行装时提示 `pnpm was not found`：先 `npm i -g pnpm` 再装。

## 需要什么

- DSH 0.2.x（`0.2.1-rc.2` 起，`dsh --version`）和 Node.js 22.12 以上。只在 0.2.1-rc.2 上实测过；DSH 插件接口有没有兼容承诺没查到，页面又是按 DSH 0.2 的前端包预编译的，所以先只放到 0.2.x，0.3 出来要重新验。
- 用模型当成员：在 DSH 设置里先配好模型和 Key。
- 用 CLI 当成员：本机装好并登录 Claude Code、Codex 或 Gemini CLI，命令在 PATH 里。
- 频道消息存在 `~/.conest-collab/collab.sqlite3`；启动 DSH 前设置 `CONEST_COLLAB_DATA` 可换目录。

## 和完整版 BotHouse 的区别

插件版只有频道本身。完整版 BotHouse 另外提供：

- 安装向导：可以选角色、选每个角色用哪个本机 CLI。插件版第一次启动自动放进鲸鱼娘一个角色，其余要自己点「添加成员」。
- 代存 Key：向导替你把 DeepSeek Key 写进 DSH。插件版在 DSH 设置里自己填。
- 外部 bot：通过 cc-connect 把 Discord、飞书等外部 bot 接进频道。

## 开发

~~~sh
cd dsh/plugin-pkg
npm run pack   # 复制 ../collab，预编译 ../packages/client-ui-discord，打出 bothouse-dsh-<版本>.tgz
dsh plugin --profile web add ./bothouse-dsh-0.1.0.tgz
~~~
