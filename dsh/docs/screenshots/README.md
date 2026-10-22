# DSH 频道插件主题与移动端预览图（模拟渲染）

> [!NOTE]
> 本目录下的截图为静态 HTML 模拟渲染预览图（由 `dsh/scripts/take-theme-screenshots.mjs` 基于 Chrome 无头模式生成），用于在脱离完整 DSH 运行时环境下离线验证 CSS 变量解析、深浅色模式样式映射、移动端响应式布局及文本对比度。并非 live DSH 动态运行时的实际截图（因本地未启动实时 DSH 桌面宿主环境）。
>
> 此外，在 macOS / Linux 深色系统环境下，`theme-system.png`（跟随系统）会通过媒体查询 `(prefers-color-scheme: dark)` 解析为深色样式，因此表现与 `theme-dark.png` 一致。
>
> **移动端视口（375×667）**：
> - `mobile-drawer-rooms.png`：左侧频道抽屉滑出，展示频道列表与创建/关闭入口（触控区域 ≥ 44px），背景带遮罩层。
> - `mobile-drawer-members.png`：右侧成员抽屉滑出，展示成员状态、添加与关闭入口（触控区域 ≥ 44px），背景带遮罩层。
