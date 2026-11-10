---
name: jiuwenswarm-channels-desktop
description: 桌面端应用外壳 channels/desktop：desktop_app.py 解析端口、拉起子进程、等待 TCP/HTTP 就绪，以及 _WindowApi 提供的窗口、更新、文件保存能力，含阅读入口与相关文档
metadata:
  scope: 只收 channels/desktop 外壳概述、阅读入口、关键文件、相关文档和改动路由；Electron 侧文件声明归 channels-desktop-contracts-01
---
# 桌面端应用外壳（channels/desktop）

## 现状

- 桌面端的启动外壳：解析端口，拉起子进程并记录日志，再等待子进程的 TCP/HTTP 服务就绪。它还通过 `_WindowApi` 给页面提供几类能力：控制窗口、记住关闭行为偏好、打开外部链接、安装更新（Windows 安装器）、下载和保存文件（data URL 或分块传输的 blob）。
- **从哪里开始读**
- `jiuwenswarm/channels/desktop/desktop_app.py` — 从 `resolve_desktop_ports`、`_start_process`、`_wait_for_tcp`/`_wait_for_http` 读起，看桌面端如何分配端口、拉起子进程并等它们就绪
- **关键文件**
- `jiuwenswarm/channels/desktop/desktop_app.py` — 本模块唯一的文件，包含下面几部分
- **相关文档**
- `README_CN.md` — 想先了解产品整体和安装、启动方式时读（没有确认里面是否专门讲桌面端）
- `docs/zh/Quickstart.md` — 想知道桌面端会拉起哪些服务、正常启动流程是什么样时参考
- `docs/zh/FAQ.md` — 排查启动失败、端口占用这类常见问题时查
- **改动路由**
- `jiuwenswarm/channels/desktop/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/jiuwenswarm-channels-desktop.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
