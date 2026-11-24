# Agent Arcade 好友客户端

Windows 商店壳和移动浏览器共用此客户端。壳加载产品配置的同源 HTTPS 地址，首页由社交服务提供。首页是「消息」，通过「通讯录」添加朋友、查看请求和发起群聊，通过「我」查看稳定用户号或退出登录。应用内使用用户号发请求和勾选群成员。

账号会话由服务端 HttpOnly Cookie 管理，历史和好友关系从真实服务读取。已登录时前台定期刷新会话、好友请求和当前聊天，回到前台或重新联网会刷新。重试同一条待发送消息沿用同一标识。消息、昵称和群名按纯文本渲染。

导航只显示本轮已可用的入口。后续 AI 联系人及群成员可走相同的用户和会话表示，陪伴与工作功能可接入同一个应用导航。Windows 商店打包和公网 HTTPS 由合版交付核对。

## 本机启动

从 Bothouse 仓库根目录运行。普通用户只打开应用入口，服务地址和数据库由部署控制。

```powershell
$env:SOCIAL_DB = Join-Path $env:TEMP 'agent-arcade-social-dev.sqlite'
npm --prefix integrations/agent-arcade/social start
```

浏览器打开服务在控制台输出的本机地址。手机浏览器支持窄屏布局，安装清单采用独立窗口显示。手机实体设备安装和商店壳尚待现场验收。

## 隔离复验

运行 `node integrations/agent-arcade/social/client/.qa/verify.cjs`。需要可由 Node.js 解析的 Playwright 包与 Windows Edge。脚本用三个合成账号、随机回环端口及临时 SQLite 走真实 HTTP 服务，保留 .qa 下的截图和机读回执，清理服务和临时库。布局参考 Signal 的精确用户名查找，以及 Element 的桌面并排导航；窄屏将会话独立展开。
