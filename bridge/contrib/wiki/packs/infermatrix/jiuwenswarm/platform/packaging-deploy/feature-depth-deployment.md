---
name: feature-depth-deployment
description: 打包与部署实现深读：ELECTRON_DIR 覆盖与 DMG 命名、build_config 单一来源、--emit-shell 输出 BUILD_* 赋值、FrontendOnly 开关、CDP 自绑端口、Electron.app 缺失 exit 1
metadata:
  scope: 只收打包与部署的实现深读；功能概览归 feature-deployment，组件级链路归 knowledge-packaging-deploy
---
# 打包与部署：实现深读

## 现状

- [[feature-deployment]]（功能概览） · [[packaging-deploy-overview]]（owner 入口）
- **ELECTRON_DIR 覆盖与 DMG 命名规则** Electron.app 来源默认按候选顺序探测（desktop 目录 node_modules、项目根、$HOME），设置 ELECTRON_DIR 环境变量可整体覆盖该探测。DMG 文件名由构建模式决定：FrontendOnly 为 <名>-frontend-test-<版本>.dmg、Test 为 <名>-test-<版本>.dmg、正式为 <名>-setup-<版本>.dmg。
- 来源：[scripts/build-electron-exe.sh:L55–L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L55-L68),
  - [scripts/build-electron-exe.sh:L301–L307](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L301-L307)
- **build_config 单一来源与 Docker 前端产物的双份落盘** dist 目录名、exe 名、版本号和 bundle 标识全部来自 scripts/build_config.py --sync --emit-shell，--sync 先同步 _build_config.py，否则 PyInstaller spec 的漂移守卫会硬失败；产物名不写死以免命中改名前的陈旧目录。容器侧 Dockerfile.claw 因后端安装早于前端构建，最终镜像把 dist 同时复制进 site-packages 的 web 路径与源码树，前者是 app_web 唯一的服务目录。
- 来源：[scripts/build-electron-exe.sh:L144–L159](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L144-L159),
  - [Dockerfile.claw:L78–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/Dockerfile.claw#L78-L85)
- **main 在 --sync --emit-shell 下经 render_shell 到 _constant_values 输出 BUILD_* 赋值** 输入是 scripts/build-electron-exe.sh:149 的 --sync --emit-shell 调用：main 先在 268-270 行经 write_expected 同步受管文件并把 updated … 状态写 stderr，280 行 load_build_config 取值；
  - 因请求了输出，跳过 285-288 行的提前 return，294 行 _emit(render_shell(config), sys.stdout)；render_shell 165 行调 _constant_values（键转大写），经 shlex.quote 生成 BUILD_*=值 写入 stdout，由脚本 150-154 行 sed 提取 BUILD_DIST_DIR_NAME / BUILD_EXECUTABLE_NAME / BUILD_VERSION 等。
- 调用路径：`scripts/build_config.py`（`main`） → `scripts/build_config.py`（`render_shell`） → `scripts/build_config.py`（`_constant_values`）
- 来源：[scripts/build_config.py:L264–L299](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build_config.py#L264-L299),
  - [scripts/build_config.py:L164–L166](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build_config.py#L164-L166),
  - [scripts/build_config.py:L149–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build_config.py#L149-L150),
  - [scripts/build-electron-exe.sh:L143–L176](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L143-L176)
- **test_build_config.py 以临时 fixture 和真实子进程 CLI 钉住漂移检测与输出流分离** test_check_detects_version_drift_before_write（80-98 行）在同步后的临时 fixture 中把根 pyproject 版本改为 9.8.7.beta6，断言 find_drift 报出 packages/jiuwenswarm-tui/pyproject.toml 与 jiuwenswarm/common/_build_config.py，且 write_expected 之后漂移清零；
  - test_cli_sync_status_uses_stderr_without_log_prefix（308-331 行）以子进程运行真实 CLI，断言 --sync --version 时 stdout 恰为版本行、stderr 恰为三条 updated 行。
- 来源：[tests/unit_tests/test_build_config.py:L80–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_build_config.py#L80-L98),
  - [tests/unit_tests/test_build_config.py:L308–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_build_config.py#L308-L331)
- **FrontendOnly 开关：macOS 脚本在 FRONTEND_ONLY=true 时写 `.frontend-only` 标记、后端复制段以 =false 守卫跳过；Windows 文档记载为不打包后端** macOS 脚本在 `FRONTEND_ONLY`=true 时向 `$APP_DIR` 写入 `.frontend-only` 标记，PyInstaller 后端复制段位于 `if [ "$FRONTEND_ONLY" = false ]` 守卫内——所示行仅证明该复制段被跳过；
  - Windows 打包文档另记载 `-Test -FrontendOnly` 为"写入 `.frontend-only` 标记，不打包后端"。
- 来源：[scripts/build-electron-exe.sh:L214–L219](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L214-L219),
  - [scripts/build-electron-exe.sh:L260–L261](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L260-L261),
  - [docs/zh/desktop-electron-packaging.md:L49–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L49-L51)
- **CDP 自绑端口免竞态、不阻塞首屏；代价是 5s 未回读 DevToolsActivePort 即禁用浏览器 sideview** packaged 版以 --remote-debugging-port=0 让 Chromium 自选端口并回读 DevToolsActivePort：免竞态窗口、不占启动关键路径（旧同步预留端口方案冷启动被杀软拖到数秒且串行阻塞首屏）；代价是文件 5s 未出现即禁用浏览器 sideview。
- 来源：[docs/zh/desktop-electron-packaging.md:L97–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L97-L108)
- **ELECTRON_DIR 未设且无候选 Electron.app 目录、或目录内二进制非文件时 exit 1** ELECTRON_DIR 为空时按 DESKTOP_DIR、PROJECT_ROOT、HOME 下 node_modules/electron/dist/Electron.app 依次取第一个存在目录；结果为空或路径非目录时输出 ERROR 与 npm install/ELECTRON_DIR 提示并 exit 1；目录存在但 $ELECTRON_APP_SOURCE/Contents/MacOS/Electron 非文件时输出含路径的 ERROR 并 exit 1。
- 来源：[scripts/build-electron-exe.sh:L55–L75](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L55-L75),
  - [scripts/build-electron-exe.sh:L77–L81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L77-L81)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/feature-depth-deployment.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh:L144-L159；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:Dockerfile.claw:L78-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh:L55-L68；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh:L301-L307
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build_config.py:L264-L299；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build_config.py:L164-L166
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build_config.py:L149-L150；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh:L143-L176
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_build_config.py:L80-L98；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_build_config.py:L308-L331
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/desktop-electron-packaging.md:L97-L108；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh:L214-L219
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh:L260-L261；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/desktop-electron-packaging.md:L49-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh:L55-L75；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh:L77-L81
- 源页字段（feature）：deployment
- 入口（entry_points）：scripts/build-electron-exe.sh；Dockerfile.claw；docker/Dockerfile.claw；docker/Dockerfile.claw.base；docker/Dockerfile.yr.rt.mgr
- 源页字段（source_globs）：scripts/build-electron-exe.sh；scripts/*；Dockerfile.claw；docker/Dockerfile.claw；docker/Dockerfile.claw.base；docker/Dockerfile.yr.rt.mgr
