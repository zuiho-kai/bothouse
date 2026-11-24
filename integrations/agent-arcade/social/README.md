# Agent Arcade 好友与群聊服务

这是 Agent Arcade 的社交模块。用户在同一产品的好友入口注册自己的用户号，搜索对方、发送申请，对方接受即可私聊。从通讯录选择好友建群，已有成员可再邀请自己的好友。普通用户使用发行包预设的服务。社交账号、好友和消息使用独立数据库，服务启动不读取桌面主人档案、QQ、模型凭据或角色私有记忆。

Windows 聊天中点 **截图** 可调用系统截屏。系统工具无法启动时，点 **应用内截图**，选择窗口或屏幕并截取画面，拖动框选后点 **预览选区**。只有在原会话点 **发送截图** 才上传所选区域。关闭选区或发送预览即可取消。

## 本机启动

需要 Node.js 24.18 或更新的 24.x。服务使用 Node 自带的 HTTP、scrypt 与 SQLite，无 npm 运行依赖。从 Bothouse 仓库根目录运行以下命令。单独部署时按[单机部署清单](deploy/README.md)一并安装共享模块。

```powershell
npm --prefix integrations/agent-arcade/social start
```

浏览器打开 `http://127.0.0.1:8787/`。两个独立浏览器档案可各自注册一个合成账号；同一档案下的两个标签页共享登录。用户号可由用户选择，昵称可重复。服务重启或换设备后使用原号和密码登录。首版无找回密码和端到端加密。默认数据库在当前操作系统用户目录的 `.agent-arcade-social/social.sqlite`，也可用 `SOCIAL_DB` 指定持久磁盘上的路径。部署进程账户独占此目录的读写权限。

## 联系 Bothouse 角色

从 **通讯录 → AI 联系人** 找到当前账号可用的 Bothouse 角色，核对角色名和用户号，点 **打开私聊**。群主可在 **群成员 → 群内 AI** 加入角色，群友在输入框通过 @ 选中它。角色由 Bothouse 提供。目录尚未分享时，请把自己的用户号告诉分享人。服务未连时可点 **重新加载 AI 联系人**，持续失败则联系好友服务管理员。

In **Contacts → AI contacts**, find an available Bothouse role by name and user ID and choose **打开私聊** (Open direct chat). A group owner can add a role under **Group members → Group AI**. In the group composer, select that member with @. If a role has not been shared with you, tell the person sharing it your user ID. If the directory cannot connect, use **重新加载 AI 联系人** (Reload AI contacts) or tell the Friends service operator.

如果对方用配对码分享角色，管理员会在好友服务主机核对账号归属并签发一次性配对码。登录对应好友账号，在 **通讯录 → AI 联系人 → 使用角色配对码** 兑换。已获授权的角色会一起出现，普通用户可以直接聊天。[管理员操作](server/bothouse/README.md)

For a first-time account with no shared roles, the service host operator can verify the account and issue a one-time pairing code. Sign in to that Friends account and redeem it under **Contacts → AI contacts → 使用角色配对码** (Use a role pairing code). All roles shared with the account then appear together. [Host operator instructions](server/bothouse/README.md)

已有个人 AI 的聊天记录可从消息列表打开。曾保存过角色资料的账号，可在「通讯录 → AI 联系人 → 原有 AI 的授权与资料」查看和撤回。

## 合成验收与同网手机入口

```powershell
npm --prefix integrations/agent-arcade/social test
npm --prefix integrations/agent-arcade/social run test:lan
```

第一条命令启动真实 HTTP 子进程。四组独立凭据测试搜索、双向私聊、去重、翻页、群权限、重新登录、进程重启和举报。另有独立的 AI 身份测试与 HTTPS 代理配置测试。数据库位于临时目录，结束后清理。

第二条命令启动独立的临时数据库，输出其路径和所有 IPv4 网卡的 LAN 地址。选 Wi-Fi 或有线网卡对应的地址，让同一可信网络内的电脑和手机分别打开；主机防火墙须允许该私有网络访问服务端口，路由器须允许设备互通。在两端各注册一个合成号，互搜号码并接受。先各发一条私聊，再从通讯录建群。用第三个合成号检查拉群前后可见性。HTTP LAN 仅用于测试凭据。Ctrl+C 停止服务。再次使用 test:lan 会开新库；要复测同一组消息，设 SOCIAL_DB 为刚才打印的文件、SOCIAL_HOST 为 0.0.0.0，再运行正常启动命令。此流程不会发送真人邀请。

## 跨网络与商店接入

运营方提供一个持续在线的主机、持久磁盘、可控制 DNS 的正式域名及有效 HTTPS 证书。浏览器和商店内的好友入口均从同一 HTTPS origin 加载页面和 API。商店打包组将这个 origin 写入发行配置。现有 Agent Arcade 账号或本机主人的登录不能作为社交用户的授权。

提供了同机 Caddy 2 反向代理配置。从 social 目录启动服务和代理，示例中域名为占位值。两个进程继承相同的配置；Linux/macOS 用相应的 export 语法。生产需用系统服务管理这两个进程。

```powershell
$env:SOCIAL_PUBLIC_ORIGIN = 'https://social.example.org'
$env:SOCIAL_HOST = '127.0.0.1'
$env:SOCIAL_PORT = '8787'
$env:SOCIAL_DB = 'D:/social-data/social.sqlite'
npm start
# 在第二个已设置同样 PUBLIC_ORIGIN、PORT 的终端，从 social 目录运行
caddy run --config Caddyfile --adapter caddyfile
```

域名 DNS 指向这台主机，向客户端开放 443，使用 Caddy 默认签发流程时使 80/443 可达。Node 只监听回环，生产 Cookie 带 Secure。代理保留原始 Host，并覆盖 X-Real-IP。健康检查为同一域名的 /healthz。域名、机位、商店身份、真实运营联系方式和线上监控由发行方配置。本仓库中的占位域名不能用于商店提交。[Caddy 官方代理配置](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

### 数据库升级、恢复与回退

- **正常升级**。用普通备份命令生成一致性快照，停服切换服务版本，继续读取当前持久库，保留现有登录与授权。[正常升级](deploy/README.md#正常升级) · [普通备份命令](deploy/README.md#持久化备份与还原)
- **灾备恢复旧快照**。按曾写入快照所含数据库的服务版本选择 `social/deploy/backup.cjs --prepare-restore`。在 1.0.21.0 和 1.0.23.0 间，只要 1.0.23.0 写过这份库，即使临时由 1.0.21.0 接管，也须用 1.0.23.0 的工具生成独立恢复副本。版本来历不明时先核对，再开放服务。随后停服保全当前库并换入恢复副本。直接换回旧目录会保留旧登录和旧授权。准备过的副本使旧登录失效，AI 授权需重新取得。[已验命令与切换检查](deploy/README.md#灾备恢复旧快照)
- **应急回退服务版本**。停服保全当前库，只用独立副本和关闭外部服务的环境启动已验证兼容的旧版。1.0.23.0 回退到 1.0.21.0 仅验真人私聊、群聊文字和原图。切回新版时沿用含回退期间新增消息和原图的库。[旧版授权保护与回退步骤](deploy/README.md#应急回退)

## 举报处理

在私聊或群聊中点具体消息旁的「⋯」（消息操作），再选「举报消息」，在好友动态中点具体帖旁的「举报动态」。核对内容并填写原因，提交后会显示举报回执。「我 → 内容准则」可查看基本规则，普通的试用意见仍从「我 → 意见反馈」提交。

运营移除后，当前打开的会话会在例行轮询中把已加载的原文换成「[已移除]」，包括翻到的旧页。同一条消息的举报窗口会关闭。用户离开群或被移出后，其他仍开着的该群页面也会清除会话和举报摘录。

运营人在持有数据库文件权限的服务主机上使用以下命令，将 SOCIAL_DB 指向待处理的社交库。list 展示至多 100 个待处理举报，show 按回执核对单笔，结果的 targetType 区分消息和动态。动态举报保留该帖在提交时的正文供运营核对，作者事后删除也可核对。remove 移除被举报的消息或动态，并处理同一条的其他待审核举报。消息会显示「[已移除]」，动态从作者和好友刷新后的列表消失。dismiss 结案且不修改被举报内容。已下载到设备上的副本无法远程擦除。运营工具没有对外开放的管理路由。

```powershell
npm --prefix integrations/agent-arcade/social run moderate -- list
npm --prefix integrations/agent-arcade/social run moderate -- show REPORT_ID
npm --prefix integrations/agent-arcade/social run moderate -- media REPORT_ID PRIVATE_DIRECTORY
npm --prefix integrations/agent-arcade/social run moderate -- remove REPORT_ID
npm --prefix integrations/agent-arcade/social run moderate -- dismiss REPORT_ID
```

`show` 有 `sharedMedia` 时，可在该举报待审核期间用 `media` 提取这一条获准的原件。请使用服务账号可写的私有目录，查看输出路径所指的 PNG、JPEG 或 WAV。每份举报只按首次提交时的选择授权，旧举报和未勾选的举报无原件可导出。审核结束后清理本次导出的本机副本。

发布前由运营方确认内容准则、真实联系入口、审核责任人和处置流程。接口参见 [客户端契约](CONTRACT.md)，商店政策见 [Microsoft Store 11.12](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#1112-user-generated-content)。

## 试用意见反馈

提交人重开「我 → 意见反馈」后，可在原反馈下查看运营留下的「处理结果」。运营在服务主机按编号执行以下命令，结果最多 500 字。复测版本确知时才填，省略时页面只显示处理结果。重复执行相同命令会保留原结果和时间，修改内容会更新同一条结果。

```sh
npm --prefix integrations/agent-arcade/social run moderate -- feedback-reply "<反馈回执>" "已修复。请重开意见反馈并核对原回执。" "1.0.16.0"
```

试用者在「我 → 意见反馈」写下问题或建议，提交前可看本次的版本，重开同一入口后，顶部「最近收到的处理结果」最多显示 5 条最新答复（含原反馈和回执），下方历史每页读取 20 条。点「查看更早的反馈」可继续翻阅自己的记录。旧客户端使用的默认反馈接口仍返回本人最近 50 条。断线后用同一账号重新打开可手动重试，保留第一次提交时的版本。反馈随附社交账户关联、网页构建号及可用的桌面包版本。

点「回顾我的聊天问题」时，服务按当前账号统计其仍可查看、由本人发送的文字，包含更早的已保存消息。群聊和私聊按实际会话计算，已移除、不可见和带附件的消息不计。同一问题类别按消息数和不同会话数显示；一条消息可涉及多个类别。自动归类提供待核对的线索，尝试过滤同条消息里已确认恢复的问题、转述及其他产品的故障。表述含糊时可能误判或漏计。回顾结果仅返回当前账号，点「把汇总加入反馈」可把数字加入现有草稿，仍需本人提交。

运营方在服务主机将 SOCIAL_DB 指向同一社交库，再运行 `npm --prefix integrations/agent-arcade/social run moderate -- feedback`。命令输出最近 100 条反馈的回执、正文、时间、网页构建号 `clientBuild` 与桌面包版本 `desktopVersion`。桌面包版本由客户端报告，未经商店验证。浏览器与未报告桌面版本的旧记录显示 `desktopVersion:null`。处理工具仅在服务主机使用。运行 `npm --prefix integrations/agent-arcade/social run moderate -- feedback-pending` 可按提交时间从早到晚查看最多 100 条未答反馈，包含较早且已不在最近 100 条里的回执。用原有 `feedback-reply` 回复后，该条即从未答列表移出；重新运行可继续处理后续反馈。

运行 `npm --prefix integrations/agent-arcade/social run moderate -- feedback-summary` 查看全部已提交意见的计数。问题和场景按同一段中的描述归类，来自个人回顾的分行统计沿用每类问题对应的群聊或私聊，零条的场景不计。每条保存的反馈在每个涉及的类别只算一笔，文中所列的聊天消息数不会累加到提交数。人数在每层按提交账号去重；同一账号可涉及多个类别、场景或版本，各分组的数字不能直接相加。版本使用提交时保存的网页构建号和客户端报告的桌面版本，`null` 表示未记录。汇总只读反馈和反馈版本，输出类别、场景、版本和计数。运营方持有具体回执编号时，可用 `npm --prefix integrations/agent-arcade/social run moderate -- feedback FEEDBACK_ID` 单独查阅原记录，包括已不在最近 100 条中的反馈。

若旧标签页中的待提交反馈当时未记录版本，新版仍会用原提交编号重试。已有回执原样读回。首次入库时两项版本均显示未记录，运营输出为 `clientType:"unknown"` 与两个空版本字段。

可复跑 `npm --prefix integrations/agent-arcade/social test`，以及有 Playwright 与 Edge 的环境下运行 `node integrations/agent-arcade/social/client/.qa/verify-feedback.cjs`。

## 角色接入契约

在 Windows 版，群主打开「群成员 → 群内 AI」，找到已加入的搭档，点「本群角色卡 → 从本机角色库选择」。例如选「禾川」，核对名称、公开设定和台词示例，勾选含“焙茶”的条目，再点「将所选内容带到群设置 → 保存到本群」。已同意与这位 AI 交谈的群友可照常点名它问「你给客人泡什么茶？」。日后在同一位置选「切回搭档原设定」并保存即可。若本机还没有卡，可先在「陪伴 → 角色」添加示例角色或导入角色卡。

单独导入的书从「陪伴 → 角色 → 世界书」入库。在「本群角色卡 → 从本机世界书库选择」，选一本书，勾选要给本群这位 AI 用的条目，再保存。适用于用户当条消息的已选条目会发给对应聊天服务商。在同一处可替换或撤销这本书，角色身份和随卡选择保留。与随卡条目一样，好友群支持常驻条目和简单关键词；含特殊触发规则的条目留在本机。

角色卡只调整本群这位搭档的说话设定。好友关系、账号、群成员及每位群友的云聊天许可各自保留。普通 HTTP 注册只签发 human 身份；可信宿主通过 server/ai-adapter.cjs 的 provisionAi(store, number, displayName) 和 bindAi(store, number, conversationId) 使用已有会话中的 AI 账号。

绑定后 identity 是公开角色身份。`readAfter(cursor)` 返回该会话可供角色读取的消息；`messageEventsAfter(cursor)` 将同一批投影为 `social.message.created` 事件。因私密内容而留在本地的找图请求、相关回复和可识别的复述均从这两个入口排除，授权成员仍可在正常聊天历史查看。cursor 为数据库消息 ID；接入方按自身账号及会话保存已处理游标，对重读事件去重。可跳过本人消息以避免自回复。`send({clientId,text})` 仅向绑定的会话写入并复用消息去重。移除成员后原绑定立即失效。宿主应只传入主动选择用于社交的公开角色资料。现阶段仅用合成 AI 身份验证，无运行中的模型或读取私有资料的接线。

## 本批交付记录

工作树基于 ca74b99。HTTP v1、持久存储、自托管和举报处理属于本模块；同目录的客户端、Windows 包和最终产品导航由对应组交付。运行测试命令可复验服务。公网域名、证书、真实手机、Microsoft Store 安装与跨公网验收须在对应环境记录。

2026-11-23，Windows、Node 24.18.0：npm test 通过 3/3。Edge 158.0.4370.33 的两个独立无窗口浏览器上下文各从页面注册，按号搜索、发送并接受申请、双向私聊、刷新取回、从通讯录建群、另一端收到群消息均通过，页面异常 0。另用同一台主机经局域网网卡地址访问 test:lan 的健康检查及实际客户端首页，两者均返回 HTTP 200。手机和公网仍待实机验收。
