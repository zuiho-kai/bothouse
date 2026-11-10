---
name: knowledge-packaging-deploy
description: packaging-deploy 组件知识：exe 分发 flag 与 deploy.sh 命令、验证入口、冻结入口与容器及 yuanrong 部署链路分工、Node/uv 捆绑构建常量
metadata:
  scope: 只收组件级知识；功能概览归 feature-deployment，实现深读归 feature-depth-deployment，yuanrong 脚本接口归 deploy-yuanrong-contracts-01
---
# packaging-deploy：冻结入口、容器与 yuanrong 部署链路

## 现状

- **公开入口：exe 分发 flag 与 deploy.sh 命令/模块**
- 冻结 exe 通过一组 --desktop-* flag 暴露子进程入口（--desktop-run-agent/-gateway/-web/-app、--desktop-prepare-runtime-workspace、--desktop-install-external-cli、--desktop-install-update），另支持 `--doctor`、`init`、`acp` 子命令；`-m ruff` 被转发到内置原生 ruff 二进制，无参数时走单实例锁后启动桌面主程序。
  - deploy.sh 的公共接口是 `up|down|restart` 命令加 `jiuwenswarm|gateway|web` 模块（默认三者全选）与 `--hosts` 选项，每个模块暴露 deploy_*/uninstall_* 钩子函数。
- Sources / 来源：[scripts/jiuwenswarm_exe_entry.py:L126–L164](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/jiuwenswarm_exe_entry.py#L126-L164),
  - [scripts/jiuwenswarm_exe_entry.py:L628–L653](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/jiuwenswarm_exe_entry.py#L628-L653),
  - [deploy/yuanrong/args_handler.sh:L46–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/deploy/yuanrong/args_handler.sh#L46-L67)
- **验证入口**
- Makefile 的测试目标包装 run_tests.sh 且传参各不相同：`test` 不带参数跑全量，`test-unit` 传 `-u`，`test-integration` 传 `-i`，`test-cov` 传 `-c`；`lint` 依次跑 ruff、pylint、mypy、codespell（后三者 `|| true` 容忍失败），`typecheck` 单独跑 mypy。web 部署的健康检查分支不同：systemd 模式轮询 `systemctl is-active` 加端口监听，失败时给出 journalctl 排查提示；
  - nohup 模式用 `pgrep -f '[j]iuwenswarm-web'` 加端口监听，失败时指向 `/tmp/jiuwenswarm-web.log`。两个运行时打包脚本的头部注释都声明由 tests/unit_tests/test_desktop_electron_contract.py 钉住打包链路契约。
- Sources / 来源：[Makefile:L125–L155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/Makefile#L125-L155),
  - [deploy/yuanrong/web_handler.sh:L126–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/deploy/yuanrong/web_handler.sh#L126-L152),
  - [deploy/yuanrong/web_handler.sh:L184–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/deploy/yuanrong/web_handler.sh#L184-L197),
  - [scripts/build-runtimes.sh:L3–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-runtimes.sh#L3-L7)
- **冻结入口与容器/部署链路的分工**
- 冻结 exe 的单一入口 `_dispatch()` 按固定顺序分发：`--doctor` 在业务 import 与单实例锁之前处理；随后依次是外部 CLI 安装/重置、`init`/`acp` 子命令、`--desktop-prepare-runtime-workspace`、各 `--desktop-run-*` 角色、`--desktop-install-update`，之后才是冻结模式下的 .py 脚本与 `-m` 转发；单实例锁只在无参数路径上检查，失败时尝试弹窗（仅 Windows/macOS，错误被吞掉）。
  - 容器侧 Dockerfile.claw 用并行 frontend/backend 阶段产出 Web bundle 与 uv 虚拟环境，最终镜像把 dist 同时复制进 site-packages 与源码树，CMD 为 `jiuwenswarm-start`。
- Sources / 来源：[scripts/jiuwenswarm_exe_entry.py:L599–L655](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/jiuwenswarm_exe_entry.py#L599-L655),
  - [scripts/jiuwenswarm_exe_entry.py:L328–L342](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/jiuwenswarm_exe_entry.py#L328-L342),
  - [Dockerfile.claw:L26–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/Dockerfile.claw#L26-L84)
- **yuanrong 部署模块与容器交付行为**
- yuanrong deploy.sh 支持 `up|down|restart` 命令与 `jiuwenswarm|gateway|web` 三个模块（缺省全选），web 模块经 `jiuwenswarm-web` 提供 frontend/dist 静态服务并把 /ws 代理到 gateway 的 WebChannel 端口，systemd 优先、nohup 回退，且服务已运行时跳过重复部署以免重启在途连接。
  - 容器最终镜像以 `jiuwenswarm-start` 启动、暴露 5173 端口，并通过 FRONTEND_HOST 让前端绑定容器外可访问的地址，而不改动源码/桌面安装使用的默认本机绑定。
- Sources / 来源：[deploy/yuanrong/args_handler.sh:L46–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/deploy/yuanrong/args_handler.sh#L46-L56),
  - [deploy/yuanrong/web_handler.sh:L5–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/deploy/yuanrong/web_handler.sh#L5-L18),
  - [deploy/yuanrong/web_handler.sh:L205–L217](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/deploy/yuanrong/web_handler.sh#L205-L217),
  - [Dockerfile.claw:L89–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/Dockerfile.claw#L89-L100)
- **Node/uv 捆绑的构建常量与默认值**
- Windows 打包链的运行时捆绑开关集中在一个函数中：BUNDLE_NODE、BUNDLE_UV 默认 "1"，NODE_VERSION 默认 "v22.11.0"，三者均可被同名环境变量覆盖，且这些默认值在模块中只出现一次、由两条打包脚本通过该函数读取。macOS 侧的 build-runtimes.sh 定义同样的默认：NODE_VERSION 默认 v22.11.0、BUNDLE_NODE 默认 1（0 跳过内置 node），也可用环境变量覆盖。
- Sources / 来源：[scripts/build-runtimes.psm1:L15–L26](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-runtimes.psm1#L15-L26),
  - [scripts/build-runtimes.sh:L11–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/scripts/build-runtimes.sh#L11-L13)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/packaging-deploy/knowledge-packaging-deploy.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/jiuwenswarm_exe_entry.py:L126-L164；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/jiuwenswarm_exe_entry.py:L628-L653
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:deploy/yuanrong/args_handler.sh:L46-L67；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:Makefile:L125-L155
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:deploy/yuanrong/web_handler.sh:L126-L152；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:deploy/yuanrong/web_handler.sh:L184-L197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-runtimes.sh:L3-L7；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/jiuwenswarm_exe_entry.py:L599-L655
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/jiuwenswarm_exe_entry.py:L328-L342；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:Dockerfile.claw:L26-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:deploy/yuanrong/args_handler.sh:L46-L56；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:deploy/yuanrong/web_handler.sh:L5-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:deploy/yuanrong/web_handler.sh:L205-L217；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:Dockerfile.claw:L89-L100
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-runtimes.psm1:L15-L26；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:scripts/build-runtimes.sh:L11-L13
