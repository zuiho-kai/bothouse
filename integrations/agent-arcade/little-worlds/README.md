# Little Worlds with Bothouse residents

从原作者的公开课程基线安装完整 Little Worlds 游戏和本次居民功能。在 Windows 终端进入本仓库的 integrations/agent-arcade/little-worlds 目录，准备 Python 3.11+、Git、Node.js 24+ 及 pnpm 11.9.0（也可用 Corepack 获取此版本），运行：

```powershell
python install.py .\LittleWorlds --run
```

在浏览器打开 http://127.0.0.1:18746/，进入游戏并着陆自己的星球。使用独立浏览器时，在同一浏览器打开 /resident-settings，选择「连接我的 Bothouse」，然后双击安装目录里的「星球居民.cmd」，选择本机预览，按提示在自己的电脑填入连接码。由 Agent Arcade 打开的世界可从星球页点「连接我的 AI」，需要兼容的 App 和本人已配对的 Bothouse。单独玩游戏无需 AI 服务。发布器细节见 additions/docs/integration/bothouse-residents.md。

关闭终端后的再次启动：`python LittleWorlds/serve.py`。默认保存于安装目录的 .data/resident-preview/world.sqlite。请使用空目录首次安装；端口已占用可选 `--port 18749`，此时选择该回环地址，同一端口使用同一存档。已有 Bothouse 角色和模型配置由房主在 Bothouse 中管理。

## How the installation works

Use an empty directory. The installer retrieves the public Git tag final-project-submission and verifies commit 809aa0dee5df7ae4e3036f67f44da9a7ca31d153. It applies the five-file patch, checks all 39 added blobs and verifies the entire reconstructed Git tree against 7fb506dd5e863e6c0365cd8844cd0490a5567764. Git HEAD stays on the public baseline with the delta staged for inspection. The build uses the upstream frozen dependency lock, skips development install hooks, and builds both the game and worker. The resulting local HTTP server binds to loopback. The first installation needs access to the public Git repo and package registry or their local equivalents. With an existing clone containing the pinned baseline and a populated pnpm store:

```sh
python install.py ./LittleWorlds --source /path/to/existing/course-repo --offline --run
```

The installed game uses actual Three.js scenes, resident meshes, a local database and the original world UI. For the bridge integration test from the installed release folder use `node scripts/verify-residents.mjs`. It exercises the real publisher and world with synthetic local Bothouse management responses. Production integrations require your own running Bothouse.

See NOTICE.md for source and asset terms, and manifest.json for the complete path, Git blob and SHA-256 list. The Agent Arcade host integration is tracked in [Bothouse PR #2180](https://github.com/zuiho-kai/bothouse/pull/2180). The command above also works for the standalone browser game. The public upstream tag identifies the baseline only.
