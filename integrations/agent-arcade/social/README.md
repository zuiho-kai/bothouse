# Agent Arcade 好友与群聊服务

这是 Agent Arcade 的社交模块。用户在同一产品的好友入口注册自己的用户号，搜索对方、发送申请，对方接受即可私聊。从通讯录选择好友建群，已有成员可再邀请自己的好友。普通用户使用发行包预设的服务。社交账号、好友和消息使用独立数据库，服务启动不读取桌面主人档案、QQ、模型凭据或角色私有记忆。

## 本机启动

需要 Node.js 24.18 或更新的 24.x。服务使用 Node 自带的 HTTP、scrypt 与 SQLite，无 npm 运行依赖。从 Bothouse 仓库根目录运行以下命令。若已经进入 `integrations/agent-arcade/social/`，可直接运行 `npm start`。

```powershell
npm --prefix integrations/agent-arcade/social start
```

浏览器打开 `http://127.0.0.1:8787/`。两个独立浏览器档案可各自注册一个合成账号；同一档案下的两个标签页共享登录。用户号可由用户选择，昵称可重复。服务重启或换设备后使用原号和密码登录。首版无找回密码和端到端加密。默认数据库在当前操作系统用户目录的 `.agent-arcade-social/social.sqlite`，也可用 `SOCIAL_DB` 指定持久磁盘上的路径。部署进程账户独占此目录的读写权限。

## 合成验收与同网手机入口

```powershell
npm --prefix integrations/agent-arcade/social test
npm --prefix integrations/agent-arcade/social run test:lan
```

第一条命令启动真实 HTTP 子进程。四组独立凭据测试搜索、双向私聊、去重、翻页、群权限、重新登录、进程重启和举报。另有独立的 AI 身份测试与 HTTPS 代理配置测试。数据库位于临时目录，结束后清理。

第二条命令启动独立的临时数据库，输出其路径和所有 IPv4 网卡的 LAN 地址。选 Wi-Fi 或有线网卡对应的地址，让同一可信网络内的电脑和手机分别打开；主机防火墙须允许该私有网络访问服务端口，路由器须允许设备互通。在两端各注册一个合成号，互搜号码并接受。先各发一条私聊，再从通讯录建群。用第三个合成号检查拉群前后可见性。HTTP LAN 仅用于测试凭据。Ctrl+C 停止服务。再次使用 test:lan 会开新库；要复测同一组消息，设 SOCIAL_DB 为刚才打印的文件、SOCIAL_HOST 为 0.0.0.0，再运行正常启动命令。此流程不会发送真人邀请。

## 跨网络与商店接入

运营方提供一个持续在线的主机、持久磁盘、可控制 DNS 的正式域名及有效 HTTPS 证书。浏览器和商店内的好友入口均从同一 HTTPS origin 加载页面和 API。商店打包组将这个 origin 写入发行配置。现有 Agent Arcade 账号或本机主人的登录不能作为社交用户的授权。

提供了同机 Caddy 2 反向代理配置。从 `integrations/agent-arcade/social/` 目录启动服务和代理，示例中域名为占位值。两个进程继承相同的配置；Linux/macOS 用相应的 export 语法。生产需用系统服务管理这两个进程。

```powershell
$env:SOCIAL_PUBLIC_ORIGIN = 'https://social.example.org'
$env:SOCIAL_HOST = '127.0.0.1'
$env:SOCIAL_PORT = '8787'
$env:SOCIAL_DB = 'D:/social-data/social.sqlite'
npm start
# 在第二个已设置同样 PUBLIC_ORIGIN、PORT 的终端，从 social 目录运行
caddy run --config Caddyfile --adapter caddyfile
```

域名 DNS 指向这台主机，向客户端开放 443，使用 Caddy 默认签发流程时使 80/443 可达。Node 只监听回环，生产 Cookie 带 Secure。代理保留原始 Host，并覆盖 X-Real-IP。健康检查为同一域名的 /healthz。备份时停止服务，再备份整个数据库目录（含存在的 WAL/SHM）；恢复时在停止状态还原目录并沿用 SOCIAL_DB。域名、机位、商店身份、真实运营联系方式和线上监控由发行方配置。本仓库中的占位域名不能用于商店提交。[Caddy 官方代理配置](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

## 举报处理

用户在具体消息上提交原因，接口只接收当前成员有权看到的该条消息。运营人在持有数据库文件权限的服务主机上使用以下命令；先将 SOCIAL_DB 指向运行中的同一个库。list 展示至多 100 个待处理举报的原因、被选消息及相关账号。remove 让该消息在后续历史、会话摘要与重试读取中显示「[已移除]」，并结案。dismiss 保留消息并结案。已下载到设备上的旧副本无法远程擦除。运营工具没有对外开放的管理路由。

```powershell
npm --prefix integrations/agent-arcade/social run moderate -- list
npm --prefix integrations/agent-arcade/social run moderate -- remove REPORT_ID
npm --prefix integrations/agent-arcade/social run moderate -- dismiss REPORT_ID
```

发布前由运营方确认内容准则、真实联系入口、审核责任人和处置流程。接口参见 [客户端契约](CONTRACT.md)，商店政策见 [Microsoft Store 11.12](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#1112-user-generated-content)。

## 角色接入契约

正式 HTTP 注册只签发 human 身份。后续可信宿主可将经主人选择的角色卡 ID 映射到该社交服务中独立的 ai 用户号，映射由宿主保管。server/ai-adapter.cjs 提供 provisionAi(store, number, displayName) 和 bindAi(store, number, conversationId)。宿主先建立明确的好友或成员关系，再绑定单个会话。当前 API 不会从角色卡自动添加好友或拉群。

绑定后 identity 是公开角色身份，readAfter(cursor) 返回该会话当前可见的消息，messageEventsAfter(cursor) 将它们投影为 social.message.created 事件。cursor 为数据库消息 ID；接入方按自身账号及会话保存已处理游标，对重读事件去重。可跳过本人消息以避免自回复。send({clientId,text}) 仅向绑定的会话写入并复用消息去重。移除成员后原绑定立即失效。宿主应只传入主动选择用于社交的公开角色资料。现阶段仅用合成 AI 身份验证，无运行中的模型或读取私有资料的接线。

## 本批交付记录

工作树基于 ca74b99。HTTP v1、持久存储、自托管和举报处理属于本模块；同目录的客户端、Windows 包和最终产品导航由对应组交付。运行测试命令可复验服务。公网域名、证书、真实手机、Microsoft Store 安装与跨公网验收须在对应环境记录。

2026-11-23，Windows、Node 24.18.0：npm test 通过 3/3。Edge 158.0.4370.33 的两个独立无窗口浏览器上下文各从页面注册，按号搜索、发送并接受申请、双向私聊、刷新取回、从通讯录建群、另一端收到群消息均通过，页面异常 0。另用同一台主机经局域网网卡地址访问 test:lan 的健康检查及实际客户端首页，两者均返回 HTTP 200。手机和公网仍待实机验收。
