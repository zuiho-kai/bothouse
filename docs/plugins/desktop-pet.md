# 桌面桌宠：`bothouse pet`

桌宠不只在插件页里播，也能单独待在桌面上。桌面窗口直接用 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的独立模式（它自带的透明、置顶、点穿空白处、可拖动的小窗和托盘），bothouse 只做转接：

```sh
bothouse pet start    # 起桌宠（第一次会用 npm 装 dsh-pet 到数据目录 pet/dsh-pet，dsh-pet 再自动下载 Electron）
bothouse pet status   # 是否在跑、端口、日志位置
bothouse pet stop     # 关掉
```

- 只有在插件页（或 `PUT /api/v1/plugins/role-bindings`）把角色绑到 `dsh-pet` 并打开开关的角色才驱动桌宠，绑定变了 2 秒内生效；没绑定就一直待机。
- 转接规则：思考 → `thinking`，干活 → `working`，交活 → `success`，出错 → `error`，空闲清回待机（dsh-pet `POST/DELETE /work-status`，气泡写角色名）；角色说的话（定稿，不含流式草稿）用 `POST /broadcast` 弹在头顶。绑了多个角色时按 error > working > thinking > celebrate > idle 取最忙的那个。
- 写接口用 dsh-pet 写给本机启动器的令牌（`$DSH_HOME/dsh-pet/standalone-runtime.json`）；停止走 dsh-pet 自己的 `POST /shutdown`。
- 需要本机有 Node.js（npm）且管理页已开（`bothouse web` 会打开它）。已装好的 dsh-pet 可用 `BOTHOUSE_DSH_PET_BIN` 指过去。桌宠外观、大小、动画沿用 dsh-pet 自己的配置（`$DSH_HOME/dsh-pet/main-config.jsonc`，默认 `~/.dsh`）。
