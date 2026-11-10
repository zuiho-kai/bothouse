---
name: feature-deployment
description: 打包与部署功能知识：Electron 壳与 Python 后端打包的职责边界、接口入口、配置条件、设计取舍、数据流、验证方式，以及 Dockerfile.claw 容器构建与交付边界
metadata:
  scope: 只收打包与部署的概览；逐文件实现细节归 feature-depth-deployment，冻结入口与 yuanrong 部署链路归 knowledge-packaging-deploy，脚本接口归 packaging-deploy-scripts-contracts-01-1
---
# 打包与部署 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/feature-deployment.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-electron-exe.sh；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/desktop-electron-packaging.md
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:Dockerfile.claw；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docker/Dockerfile.claw；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docker/Dockerfile.claw.base
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docker/Dockerfile.yr.rt.mgr
- 源页字段（feature）：deployment
- 入口（entry_points）：scripts/build-electron-exe.sh；Dockerfile.claw；docker/Dockerfile.claw；docker/Dockerfile.claw.base；docker/Dockerfile.yr.rt.mgr
- 源页字段（source_globs）：scripts/build-electron-exe.sh；scripts/*；Dockerfile.claw；docker/Dockerfile.claw；docker/Dockerfile.claw.base；docker/Dockerfile.yr.rt.mgr；jiuwenswarm/channels/browser/frontend/eslint.config.js；jiuwenswarm/channels/browser/frontend/scripts/pack.js
  - jiuwenswarm/channels/browser/frontend/vite.config.ts；jiuwenswarm/channels/browser/frontend/vite.content.config.ts；jiuwenswarm/common/_build_config.py；scripts/build_config.py；scripts/verify_a2ui_bundle.py；scripts/verify_gitcode_cli_bundle.py
  - scripts/verify_playwright_mcp_bundle.py；scripts/build-electron-exe.ps1；scripts/build-exe.ps1；scripts/jiuwenswarm_exe_entry.py；deploy/yuanrong/gateway_handler.sh；scripts/build-harmony.sh；scripts/build-harmony-hap.sh；scripts/nfs/setup_nfs_client.sh
  - scripts/nfs/setup_nfs_server.sh；scripts/nfs/teardown_nfs_client.sh；scripts/nfs/teardown_nfs_server.sh；scripts/verify_rsi_bundle.py；scripts/build-runtimes.psm1；scripts/build-runtimes.sh；scripts/openjiuwen_team_mcp_exe_entry.py；scripts/build_python_packages.py
  - scripts/build_tui.py；packages/jiuwenswarm-tui/setup.py；packages/jiuwenswarm-tui/jiuwenswarm_tui/app.py；deploy/yuanrong/web_handler.sh；scripts/installer.iss；scripts/jiuwenswarm.iss；deploy/yuanrong/args_handler.sh；deploy/yuanrong/check_handler.sh；deploy/yuanrong/deploy.sh
  - deploy/yuanrong/global_vars.sh；deploy/yuanrong/jiuwenswarm_handler.sh；deploy/yuanrong/envfile_handler.sh；deploy/yuanrong/template_handler.sh；deploy/yuanrong/cmd_handler.sh；deploy/yuanrong/common.sh
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 构建脚本装配 Python、前端和运行时资源，部署脚本再安排进程与环境。源码运行成功不能单独证明打包后的资源路径或二进制依赖完整。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[scripts/build-electron-exe.sh:L1–L332](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L1-L332)；
  - [docs/zh/desktop-electron-packaging.md:L1–L333](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L1-L333)。

### 接口与调用入口（API）

- 当前 macOS Electron 脚本支持无参数发布、--test 测试和 --frontend-only 前端构建，依次构建 Web、安装桌面依赖、编译 TUI、冻结后端、组装资源并输出 DMG。FrontendOnly 跳过 Python 依赖与 PyInstaller 后端，仍组装前端和壳；容器版本通过 Dockerfile 的构建参数与 CMD 启动入口交付，二者需要分别验证。
- 源码与文档：[scripts/build-electron-exe.sh:L1–L332](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L1-L332)；
  - [docs/zh/desktop-electron-packaging.md:L1–L333](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L1-L333)。

### 配置入口与生效条件

- 脚本路径从自身目录解析，ELECTRON_DIR 可指定 Electron.app，构建配置脚本同步产物名、版本和 bundle 标识；--test 与 --frontend-only 是构建开关。前端构建使用 ELECTRON=true，完整包复制冻结后端和 Node 运行时。容器构建的 BASE_IMAGE、NODE_VERSION 或 JIUWENSWARM_VERSION 各有对应文件，不能把桌面启动参数当成该脚本的构建选项。
- 源码与文档：[scripts/build-electron-exe.sh:L1–L332](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L1-L332)；
  - [docs/zh/desktop-electron-packaging.md:L1–L333](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L1-L333)。

### 设计取舍

- **设计推断**：Electron 壳复用 Python 后端和 Web 前端，减少重新实现业务逻辑的成本；代价是前端资源、冻结后端、子进程环境和端口必须一起交付。FrontendOnly 构建有独立的连接条件，不能用它的成功推断完整安装包包含后端。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[scripts/build-electron-exe.sh:L1–L332](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L1-L332)；
  - [docs/zh/desktop-electron-packaging.md:L1–L333](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L1-L333)。

### 数据流与关联功能

- 构建脚本装配 Python、前端和运行时资源，部署脚本再安排进程与环境。源码运行成功不能单独证明打包后的资源路径或二进制依赖完整。 联调时结合[[feature-desktop]]（桌面宿主与自动更新）、[[feature-bootstrap]]（初始化与服务启动）、[[feature-sandbox]]（JiuwenBox 隔离执行）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[scripts/build-electron-exe.sh:L1–L332](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L1-L332)；
  - [docs/zh/desktop-electron-packaging.md:L1–L333](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L1-L333)。

### 怎样验证

- 从构建产物启动而非源码目录启动，检查 Web、AgentServer、Gateway 的子进程、环境和静态资源。分别验证正常退出的进程收尾、端口占用、缺失资源和 FrontendOnly 连接外部后端的路径。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[scripts/build-electron-exe.sh:L1–L332](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-electron-exe.sh#L1-L332)；
  - [docs/zh/desktop-electron-packaging.md:L1–L333](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L1-L333)。

### 容器构建与交付边界

- 根目录 Dockerfile.claw 使用 base、frontend、backend 和最终镜像阶段，分别构建 Web 和 uv 虚拟环境，再复制运行时与产物。后端安装早于前端构建，最终镜像因此把 dist 同时放进 site-packages 的 Web 路径与源码目录，避免 wheel 中缺少尚未生成的静态资源；启动环境通过 FRONTEND_HOST 监听全部接口，CMD 为 jiuwenswarm-start。
- 源码依据：[Dockerfile.claw:L1–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/Dockerfile.claw#L1-L100)。
- docker 目录的 claw 镜像从固定 Node stage 复制运行时，再在 app 用户下构建 Web 并 pip 安装项目。安装后执行捆绑 Playwright MCP 的本地启动校验，最后使用 jiuwenswarm-start；它与根目录多阶段 uv 构建不同，选用镜像时需核对依赖安装方式、静态资源位置和实际构建上下文。
- 源码依据：[docker/Dockerfile.claw:L1–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docker/Dockerfile.claw#L1-L45)。
- claw.base 文件只提供 Python 和 Node 的基础运行环境，从 Node stage 复制 node、npm、npx 与 node_modules。它没有复制 JiuwenSwarm 源码、安装项目或声明服务启动 CMD，因此基础镜像构建成功只能说明运行时材料准备完成，不能证明应用服务与前端资源已经被打包。
- 源码依据：[docker/Dockerfile.claw.base:L1–L9](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docker/Dockerfile.claw.base#L1-L9)。
- yr.rt.mgr 镜像从 BASE_IMAGE 继续构建，临时清空 PYTHONPATH，以 snuser 安装指定 JIUWENSWARM_VERSION 的 Python 包，再切回 sn 用户并恢复原 PYTHONPATH。它依赖基础镜像中已有账户与 Python 环境，当前文件没有独立应用启动命令；运行管理器如何启动服务仍需沿 Yuanrong 部署链路查证。
- 源码依据：[docker/Dockerfile.yr.rt.mgr:L1–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docker/Dockerfile.yr.rt.mgr#L1-L16)。
- 建议分别验证选定 Dockerfile 的构建上下文、静态资源路径、运行账户和启动命令。以上说明来自静态源码，本页未构建镜像或安装包。
