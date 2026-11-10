---
name: feature-depth-desktop
description: 桌面宿主与自动更新实现深读：更新助手子命令（--desktop-install-update）契约、用户工作区目录优先级、端口解析与安装器失败处理、只清 webview 缓存子目录、resolve_desktop_ports 复用端口组扫描及其单测、main 启动与收尾路径
metadata:
  scope: 只收桌面宿主的实现层深读条目；功能概览归 feature-desktop
---
# 桌面宿主与自动更新：实现深读

## 现状

- [[feature-desktop]]（功能概览） · [[launch-overview]]（owner 入口）
- **main 的更新助手子命令契约** 调用方以 UPDATE_HELPER_FLAG（--desktop-install-update）加 --installer-path/--parent-pid/--backend-port/--frontend-port 触发安装；这些参数在 _parse_args 中被隐藏（argparse.SUPPRESS），helper 分支执行后 main 直接 return，不再进入常规桌面启动路径。
- 来源：[jiuwenswarm/channels/desktop/desktop_app.py:L3514–L3536](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L3514-L3536),
  - [jiuwenswarm/channels/desktop/desktop_app.py:L3565–L3598](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L3565-L3598)
- **用户工作区目录的优先级** get_user_workspace_dir 按缓存值 → 环境变量 JIUWENSWARM_DATA_DIR（多实例隔离）→ 用户主目录下 .jiuwenswarm 的顺序解析；桌面端的 .updates 残留清理、webview 存储目录均落在该目录下。
- 来源：[jiuwenswarm/common/utils.py:L416–L433](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L416-L433),
  - [jiuwenswarm/channels/desktop/desktop_app.py:L384–L402](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L384-L402)
- **端口解析失败与安装器启动失败的处理** main 中 resolve_desktop_ports 抛出 RuntimeError 时记录错误并以 SystemExit(1) 退出；更新 helper 里安装包 Popen 失败仅 logger.error 记录后返回，不重试、不向用户界面传播。
- 来源：[jiuwenswarm/channels/desktop/desktop_app.py:L3565–L3598](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L3565-L3598),
  - [jiuwenswarm/channels/desktop/desktop_app.py:L673–L707](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L673-L707)
- **只清缓存子目录、保留 localStorage** _clear_webview_http_cache 的文档说明：过去每次启动整目录清空 storage_path 以免陈旧 JS/CSS，但会连带清掉 localStorage（丢失每来源 UI 状态）；现改为只删缓存子目录并对失败 ignore_errors，使残留的 WebView2 进程不会中断启动。收益是保留用户状态，代价是缓存清理可能不完整（文档认为无害）。
- 来源：[jiuwenswarm/channels/desktop/desktop_app.py:L3105–L3119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L3105-L3119),
  - [jiuwenswarm/channels/desktop/desktop_app.py:L3121–L3126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L3121-L3126)
- **桌面端口解析复用 instance_manager 的端口组扫描** resolve_desktop_ports（desktop_app.py 354-358 行）直接调用 instance_manager 的 find_available_ports(base_index=0)：每个 index 由 calculate_instance_ports 得到整组端口，须全部 is_port_available 且不在 exclude_ports 才采用，桌面因此与多实例服务共用 base + index×1000 的同一分配规则；
  - docstring 声明结果仅存在于本次进程内存/子进程 env（no config persistence），Electron 壳文档亦把端口模型标注为与 Python 桌面完全一致、来源即 instance_manager/config.py。
- 来源：[jiuwenswarm/channels/desktop/desktop_app.py:L340–L381](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L340-L381),
  - [jiuwenswarm/instance_manager/config.py:L454–L497](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/instance_manager/config.py#L454-L497),
  - [docs/zh/desktop-electron-packaging.md:L29–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/desktop-electron-packaging.md#L29-L41)
- **resolve_desktop_ports 的端口组测试断言** tests/unit_tests/test_desktop_port_resolve.py:223-252 三个用例均 monkeypatch desktop_app.find_available_ports 后断言 resolve_desktop_ports：默认组等于 calculate_instance_ports(0) 且 frontend/web 与 BASE_PORTS 一致；回退组 index=1 时端口为 BASE_PORTS+1000；
  - 返回 None 时抛 RuntimeError 匹配 'No available desktop port group'。此为测试断言的静态记录，不证明当前已运行通过。
- 来源：[tests/unit_tests/test_desktop_port_resolve.py:L223–L252](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_desktop_port_resolve.py#L223-L252)
- **desktop_app.main：desktop_install_update 为假（getattr 默认 False）分支的启动路径与收尾** desktop_install_update 为假时，main() 先执行 _cleanup_stale_update_artifacts() 与 _setup_tui_path()，再调用 resolve_desktop_ports()；若抛 RuntimeError 仅记日志并 raise SystemExit(1)；
  - 成功后以 FRONTEND_HOST=127.0.0.1 构造 DesktopRuntime 并 run()，finally 中调用 runtime.shutdown()。
- 来源：[jiuwenswarm/channels/desktop/desktop_app.py:L3565–L3598](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L3565-L3598),
  - [jiuwenswarm/channels/desktop/desktop_app.py:L67–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/desktop/desktop_app.py#L67-L85)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/feature-depth-desktop.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/desktop/desktop_app.py:L3514-L3536；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/desktop/desktop_app.py:L3565-L3598
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/utils.py:L416-L433；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/desktop/desktop_app.py:L384-L402
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/desktop/desktop_app.py:L673-L707；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/desktop/desktop_app.py:L3105-L3119
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/desktop/desktop_app.py:L3121-L3126；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/desktop/desktop_app.py:L340-L381
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/instance_manager/config.py:L454-L497；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/desktop-electron-packaging.md:L29-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_desktop_port_resolve.py:L223-L252；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/desktop/desktop_app.py:L67-L85
- 源页字段（feature）：desktop
- 入口（entry_points）：jiuwenswarm/channels/desktop/desktop_app.py
- 源页字段（source_globs）：jiuwenswarm/channels/desktop/desktop_app.py；jiuwenswarm/channels/desktop/*
