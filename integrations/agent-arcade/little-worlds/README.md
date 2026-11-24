# Little Worlds with Bothouse residents

从原作者的公开课程基线安装完整 Little Worlds 游戏和本次居民功能。在 Windows 终端进入本仓库的 integrations/agent-arcade/little-worlds 目录，准备 Python 3.11+、Git、Node.js 24+ 及 pnpm 11.9.0（也可用 Corepack 获取此版本），运行：

```powershell
python install.py .\LittleWorlds --run
```

在浏览器打开 http://127.0.0.1:18746/，进入游戏并着陆自己的星球。使用独立浏览器时，在同一浏览器打开 /resident-settings，选择「连接我的 Bothouse」，然后双击安装目录里的「星球居民.cmd」，选择本机预览，按提示在自己的电脑填入连接码。由 Agent Arcade 打开的世界可从星球页点「连接我的 AI」，需要兼容的 App 和本人已配对的 Bothouse。从 Agent Arcade 的真人好友私聊点「会话设置 → 拜访好友星球」。目标房主已允许好友拜访时，登船后可确认目的地并起飞。访友需要 #2180 中相应的新版社交端。单独玩游戏无需 AI 服务。发布器细节见 additions/docs/integration/bothouse-residents.md。

关闭终端后的再次启动：`python LittleWorlds/serve.py`。默认保存于安装目录的 .data/resident-preview/world.sqlite。请使用空目录首次安装；端口已占用可选 `--port 18749`，此时选择该回环地址，同一端口使用同一存档。已有 Bothouse 角色和模型配置由房主在 Bothouse 中管理。

## 与 Agent Arcade 好友共用星球

房主只需在好友 App 里登录。部署者第一次安装时可指定可信桌面包的 service.json，安装器读取其中的 `origin` 和 `littleWorldsOrigin`。同一份世界存档下次直接运行 serve.py 仍会使用这两个地址。

```powershell
python install.py .\LittleWorlds --desktop-service .\desktop\resources\app\service.json --run
```

自建服务也可用 `--friends-origin` 与 `--world-origin` 指定两个完整 HTTPS 原点，好友服务的 `LITTLE_WORLDS_ORIGIN` 应与游戏原点相同。回环开发可用 HTTP。游戏监听在回环，异地访问使用部署者自己的 HTTPS 反向代理。独立课程游戏继续使用上方无服务参数的安装命令。

换设备登录同一好友账号后，已核实的存档会恢复原玩家。旧存档若只留在旧设备，请先在原 App 档案打开一次。允许好友拜访和连接居民分别设置；没有 AI 的房主也能分享，撤回后好友重新打开时不再获得目的地。详见 [双端部署](additions/docs/integration/friends-home.md)。

## How the installation works

Use an empty directory. The installer retrieves the public Git tag final-project-submission and verifies commit 809aa0dee5df7ae4e3036f67f44da9a7ca31d153. It applies the patch, checks every added blob and verifies the entire reconstructed Git tree against the worldTree pinned in manifest.json. Git HEAD stays on the public baseline with the delta staged for inspection. The build uses the upstream frozen dependency lock, skips development install hooks, and builds both the game and worker. The resulting local HTTP server binds to loopback. The first installation needs access to the public Git repo and package registry or their local equivalents. With an existing clone containing the pinned baseline and a populated pnpm store:

```sh
python install.py ./LittleWorlds --source /path/to/existing/course-repo --offline --run
```

The installed game uses actual Three.js scenes, resident meshes, a local database and the original world UI. For the bridge integration test from the installed release folder use `node scripts/verify-residents.mjs`. It exercises the real publisher and world with synthetic local Bothouse management responses. Production integrations require your own running Bothouse. When Agent Arcade sends its language on the first visit, the world uses it until you pick a language in the game. An authorized native DSH resident shows working when its verified local Bothouse Engine is busy.

See NOTICE.md for source and asset terms, and manifest.json for the complete path, Git blob and SHA-256 list. The Agent Arcade host integration is tracked in [Bothouse PR #2180](https://github.com/zuiho-kai/bothouse/pull/2180). The command above also works for the standalone browser game. The public upstream tag identifies the baseline only.
