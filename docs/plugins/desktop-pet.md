# 桌面桌宠：`bothouse pet`

桌宠不只在插件页里播，也能单独待在桌面上。桌宠是 bothouse 自带的一份（`plugins/desktop-pet`），fork 自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）：透明、置顶、点穿空白处、可拖动的小窗和托盘照上游，右键菜单接 bothouse。fork 的改动、上游基线提交和同步方法见 `plugins/desktop-pet/BOTHOUSE.md`。

```sh
bothouse pet start    # 起桌宠（第一次用 npm 装本版本发布页上的 bothouse-pet.tgz 到数据目录 pet/app，再自动下载 Electron）
bothouse pet status   # 是否在跑、端口、日志位置
bothouse pet stop     # 关掉
```

- 只有在插件页（或 `PUT /api/v1/plugins/role-bindings`）把角色绑到 `dsh-pet` 并打开开关的角色才驱动桌宠，绑定变了 2 秒内生效；没绑定就一直待机。
- 转接规则：思考 → `thinking`，干活 → `working`，交活 → `success`，出错 → `error`，空闲清回待机（dsh-pet `POST/DELETE /work-status`，气泡写角色名）；角色说的话（定稿，不含流式草稿）用 `POST /broadcast` 弹在头顶。绑了多个角色时按 error > working > thinking > celebrate > idle 取最忙的那个。
- 写接口用 dsh-pet 写给本机启动器的令牌（`$DSH_HOME/dsh-pet/standalone-runtime.json`）；停止走 dsh-pet 自己的 `POST /shutdown`。
- 右键菜单：「打开 AI 设置」开管理页；「查看余额」看 bothouse 今天、本月的用量；「待办事项」列任务板上没收口的活（只读）；「碎碎念」随机说一句绑定角色这次启动后说过的话；「对话」在绑定角色最近的会话里叫醒它跑一轮，回话回到对话框（它也照常发在那个会话）。「配图」配上角色说过的一句；睡觉、动作、显示位置、重载配置、回到初始位置照上游。
- 需要本机有 Node.js 22.12+（npm）且管理页已开（`bothouse web` 会打开它）。本地调试用 `BOTHOUSE_PET_DIR` 指向编好的 `plugins/desktop-pet`，或用 `BOTHOUSE_PET_PACKAGE` 指定别的包。桌宠外观、大小、动画沿用 dsh-pet 自己的配置（`$DSH_HOME/dsh-pet/main-config.jsonc`，默认 `~/.dsh`）。
