# Agent Arcade Windows 商店交接

给软件7、客户端与统一发行。首发用 Microsoft Store 的 **MSIX** 路径。首批获准的朋友在 Windows 的 Microsoft Store 应用里搜索正式产品名。安装后用 Agent Arcade 账号注册或登录，进入「消息」，可在通讯录按用户号搜索、接受好友请求并建群。服务地址在构建时写入，真人聊天无需填写服务地址或模型密钥。

## 构建和测试

使用 x64 Visual Studio Developer PowerShell 和 Windows SDK。打开 Bothouse 检出目录，进入 Agent Arcade 模块根，再安装锁定的构建和运行依赖：

```powershell
cd integrations/agent-arcade
npm ci
npm exec -- install-electron
```

从已平铺的完整源码 ZIP 解压时，在含 `package-lock.json`、`src/` 和 `social/` 的目录依次运行 `npm ci` 和 `npm exec -- install-electron`，把锁定的 Electron 运行时落到 `node_modules/electron/dist`。打包器需要 Node 24.x、MSVC 的 `cl.exe`、SDK 的 C++/WinRT 标头、MakeAppx、锁定的 Electron x64 及 pngjs。签测试包还需 SignTool。用 `--dependency-root` 指定含 Electron `dist` 和 pngjs 的完整依赖目录；用 `--production-root` 指定同一锁文件的运行时依赖目录。两者都省略时使用 Agent Arcade 模块根。

在模块根运行 `node social/windows/pack.cjs`。包内 `Social/resources/app/service.json` 保存两端原点和桌面版本。好友服务取同一冻结提交的 [HTTPS 部署工程](../deploy/README.md)，由运营方单独启动并保存数据库。

桌面「更多 → 小星球」打开已有 Little Worlds 服务。「返回消息」保留原会话和未发草稿。需要小星球时，在打包及商店前检命令中都加入 `--world-origin $approvedWorldOrigin`。打包器将规范化后的地址写入包内 `service.json`，朋友安装后直接使用。正式包要求可部署的 HTTPS DNS 原点，且只使用随包地址。测试包沿用模式允许的本机原点，也可由环境变量 `LITTLE_WORLDS_ORIGIN` 覆盖。仅聊天构建省略该参数。登录好友账号后进入小星球。App 按好友服务、已登录的好友用户号和世界地址分别保存世界会话；再次用同一账号进入可续接原星球。在原档着陆自己的星球后，点「连接我的 AI」，通讯录里已获准的 Bothouse 角色就会成为居民，返回消息后继续同步。在自己的星球点「断开我的 AI」即可移除这批居民。另一台设备登录同一好友账号后，从相同入口回到已关联的星球。旧档仅保留本地房主身份时，先从原设备进入一次完成关联。着陆家园后点「允许好友来访」，真人好友即可从私聊找到它，房主离线也可拜访。「关闭好友来访」收回该入口。来访可独立于 AI 开启。[主机配置](../deploy/README.md#小星球居民)

下面两条 `node pack.cjs` 命令从 Agent Arcade 模块内的 `social/windows` 目录运行。测试后端用共享服务，放在回环 `127.0.0.1:8765`，分配一份独立临时 `SOCIAL_DB`。浏览器/服务器联调见 [社交服务说明](../README.md)。

```powershell
node pack.cjs --mode test-signed --version 1.0.0.0 --origin http://127.0.0.1:8765 --dependency-root "../.."
node pack.cjs --mode test-signed --version 1.0.1.0 --origin http://127.0.0.1:8765 --dependency-root "../.."
# 将构建输出的两个 file 路径分别填到 $first 和 $second。
$signed = ./sign-local-test.ps1 -Packages $first,$second -PublicCertificate ./out/isolated-test.cer
# 下列命令仅在已有授权的可丢弃 Windows 环境运行。
# 按微软的侧载文档，仅在该环境预先信任匹配的测试证书。
./check-lifecycle.ps1 -First $signed[0].file -Upgrade $signed[1].file -Receipt ./out/isolated-lifecycle.json
node --test verify-view.test.cjs verify-local-host.test.cjs
```

测试签名使用同一张 14 天临时证书签两个版本，私钥文件随后移除，不修改信任库。该身份只用于侧载，在接触包前由脚本检查，拒绝动已有同名测试注册。生命周期脚本验证首装版本、同一包族升级的版本、卸载以及残留情况。它不启动应用；真实冷开、连续登录与更新后会话保持另外验。旧的 `--mode test` 用微软的未签名测试 OID，可复现未签名注册拒绝。测试包与 cert 均不用于给朋友分发。[微软签名说明](https://learn.microsoft.com/en-us/windows/msix/package/sign-msix-package-guide) · [未签名包限制](https://learn.microsoft.com/en-us/windows/msix/package/unsigned-package)

## 一个长期商店身份

Partner Center 保留一条 **Agent Arcade** 产品记录，第一版和以后增加本机能力的同架构版本沿用正式的 `Identity/Name`、`Identity/Publisher`、`PublisherDisplayName` 和 `Application/Id=Social`，保持同一包族和同一个启动入口。正式版本号单调增加，第四段保留 0。测试身份独立，任何朋友都从正式 Store 产品页安装及更新。MSIX 由 Store 托管、签名和更新；没有给朋友另设桌面启动器或自更新服务。[分发方式](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path) · [商店 MSIX 自查](https://learn.microsoft.com/en-us/windows/apps/publish/store-readiness-checklist)

主窗口未登录时显示好友服务的登录或注册页。登录后进入「消息」，从「通讯录」按用户号查找好友。管理员从「更多 → Bothouse 管理」配置角色和授权。好友从「通讯录 → AI 联系人」进入获准的角色私聊，在原会话中聊天和交办。桌面「更多 → 小星球」进入自己的星球。房主允许来访后，好友可从该真人私聊的「会话设置 → 拜访好友星球」前往。点「返回消息」或「返回原聊天」可继续原草稿。

陪伴、创作、工作和渠道等本机功能仍从「更多」进入，使用桌面本机资料。好友服务登录和原便携版档案各自存放。公开商店分发与下方测试包安装是两套身份。

远程视图沿用独立会话分区、同源限制、沙箱和上下文隔离。「陪伴」「工作」的本机 preload 和 IPC 保持在本机主窗口内。好友视图的独立隐私脚本只在同源隐私主页面处理用户主动打开公开 HTTPS 支持网页的操作，且由主进程核对服务公开配置。其余好友导航仍在同一 origin 内。包内 Windows 更新入口由商店产品承担。原便携版与商店版使用不同档案。

## 应用内检查商店更新

在本机「设置 → 应用更新」可看运行版本并检查新版。正式版从同进程的 Electron 主窗口传入 HWND，由 C++/WinRT `StoreContext` 查询本产品的包。点「下载并安装」后交给 Windows 确认，取消后可继续使用。商店不可用时可以明确打开 Microsoft Store 的「更新和下载」页，界面只报告打开请求。测试包会直接说明没有正式商店身份。个人 RC 仍走现有本机更新及正常退出流程。 [商店更新 API](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/package-updates-from-store) · [商店更新页 URI](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-store-app)

软件7集成时保持 `storeEdition:true`、包内 `service.json` 的 `mode`、同一 `Identity` 和 `Application/Id`。打包器从 `store-update.cpp` 编译 `resources/app/store-update.node`，收录它的 SHA-256。IPC 仍由本机设置页发起，社交 WebContents 无法使用。以下验证使用已解包的测试 MSIX 和 headless Edge，将商店返回值与 URI 启动替换为可观测替身。

```powershell
node social/windows/verify-store-update.cjs "<解包>/Social/resources/app" "<构建输出>/receipt.json" "<已安装开发依赖的检出>"
```

商店分发准备好后，从 Microsoft Store 测试分发真实安装旧版本，在同包族发布更高版本。复核应用内检查和商店确认窗的归属、取消、真实下载及安装、重开版本和同一登录档案，再核对备用更新页。测试 MSIX 与替身结果不能代替该验收。

## 从本地未签名包复验

在 Agent Arcade 模块根目录给测试包配置一个空闲回环端口。使用 MakeAppx 解包，再运行下方脚本。脚本使用已安装的 Playwright、同一提交的服务、两个合成账号和临时档案，检查启动、双向私聊、意见反馈、重开保持登录、切到陪伴导入角色、切到工作读取本地资料，以及服务离线时仍可进入工作。实测过程中原生主窗口保持隐藏。文件选择器指向脚本生成的合成资料。

```powershell
node social/windows/pack.cjs --mode test --version 1.0.2.0 --origin http://127.0.0.1:59243 --dependency-root "<已安装开发依赖的检出>"
# 使用 SDK 的 makeappx.exe unpack /p "<输出的 msix>" /d "<空目录>"
node social/windows/verify-unified-package.cjs "<解包目录>/Social/AgentArcadeSocial.exe" "<证据目录>"
```

此项验证的是解包后 EXE 的行为。系统注册、受信任安装、更新和商店认证各有独立验收。

复验好友图片的另存为时，使用已解包的 `test` 模式 EXE 和仓库开发依赖。脚本在临时副本运行隐藏窗口和合成账号，检查 PNG、JPEG 原字节、取消、移除和退群后的访问。系统另存为及错误提示用替身返回，其他步骤经过真实 Windows 壳和社交服务。

```powershell
node social/windows/verify-image-save.cjs "<解包目录>/Social/AgentArcadeSocial.exe" "<证据目录>"
```

## 验证包内好友 HTTPS

将测试包的 origin 设为 `https://arcade-store.test:<空闲端口>`。从同一冻结提交执行打包、解包和下面的验收。保留域 `arcade-store.test` 可用于 `test` 或 `test-signed` 测试模式，验收进程通过 Chromium 的主机解析参数将它指向 127.0.0.1。

```powershell
node social/windows/pack.cjs --mode test --version 1.0.3.0 --origin https://arcade-store.test:63477 --dependency-root "<已安装开发依赖的检出>"
node social/windows/verify-https-package.cjs "<解包目录>/Social/AgentArcadeSocial.exe" (Get-Command openssl.exe).Source "<证据目录>"
```

验收启动回环 HTTPS 代理及同提交的社交服务，临时 CA 仅在脚本启动的社交会话中使用。OpenSSL 验证 Chromium 实际收到的证书链、域名、有效期和服务端用途，另用错误 CA 确认拒绝。脚本检查两个桌面进程中的 Secure、HttpOnly 持久 Cookie、双向消息和冷开恢复。证书、私钥、数据库和档案均生成在临时目录，结束后清理。

统一源码沿用原 QQ 入口，收取 `b829576`、`016937c`、`67fef041` 的贴图和上下文图片区分、按群回答绘图能力，以及从群设置连接云绘图凭据。Git 自动合并了两边对 `src/main.cjs` 的改动。

## 复验统一包及同版服务

统一包以同一个 Git 提交生成 MSIX 和服务 ZIP。从冻结源码解出测试脚本，从服务 ZIP 解出 social 目录，然后运行：

```powershell
$env:ARCADE_QA_SERVICE_ROOT = '<服务解包目录>/social'
node social/windows/verify-https-package.cjs "<MSIX 解包目录>/Social/AgentArcadeSocial.exe" (Get-Command openssl.exe).Source "<证据目录>" --unified
```

该模式验证无 AI 密钥时的好友／群聊、两端开着的私聊和群聊自动撤下举报消息、另一页退群后旧页清除内容、从通讯录同意并开启 AI 私聊、真实忙碌和额度错误文案。模型请求由测试进程中的替身接收。商店更新设置先读实际测试身份，再使用系统替身验证当前无新版、发现新版、取消、网络限制及商店回退提示。真实商店安装和更新另验。

保持同一 `ARCADE_QA_SERVICE_ROOT`，用 `--privacy-contact-packaged` 复验解包自带的隐私联系入口。它从好友登录页打开隐私说明，验证联系方式可复制、指定 HTTPS 网址交给系统浏览器入口，以及普通外链仍被拦截。验收替换系统浏览器启动并拦截系统剪贴板写入。

### 1.0.6.0 测试包独立验收（有条件签回）

冻结源码 `ace06296db2cce69fdb6a29d4c6b735c6a52badb` 的真人收发、PNG/JPEG 原图保存、保存期间权限撤销、同名会话投递和群主移出通过独立验收。

1.0.6.0 的 Windows 隐私页会显示运营方配置的 HTTPS 链接，点击时被应用壳拦截。此问题已在下述 1.0.7.0 测试包复验通过。

### 1.0.7.0 测试包独立验收（本机成品通过）

冻结源码 `2b88879a59a1104964db1330c191b14ea4b64c4e`。独立验收从实际 MSIX 解包启动 Windows 壳，使用同版服务验证群 AI 自然接话、原图贴图、纯文字和真人点名对照。登录前可从隐私页用鼠标或 Enter 将完整的公开 HTTPS 地址交给默认浏览器启动边界（测试替身），普通站外跳转仍受限。

同库升级保留两个账号的登录与历史。灾备恢复后两枚旧登录失效，重新登录可读回快照中的好友、消息和原图，已移除的图片仍无法读取，云授权需重新同意。实际商店安装、更新和跨网收发仍待验。

独立机读回执 SHA-256 `c5e8c016a487c96bdc32a5433356059ae8b30cad28609b42f257836151a9e536`。

### 1.0.8.0 测试包独立验收（本机成品通过）

冻结源码 `f9b4a9edcad981b490db9069b18ab7fc36768f15`。独立验收从实际 MSIX 解包启动 Windows 壳，使用同版服务和回环 HTTPS。真人录音在发送前可本地试听或取消，收件端在气泡内播放，WAV 与发件端试听逐字节一致。切会话、退群时停止播放，退群后照片和语音原件均返回 404。

混合群照片可用 Windows 保存入口写出同字节原图。真人照片、录音及其原件地址产生零模型请求，点名 AI 的普通文字单独走获准服务。测试使用模拟麦克风、模型与另存为对话框替身。真实音频设备、正式公网和 Microsoft Store 安装及更新待验。公开图检索及 AI 合成语音属于后续候选。

独立机读回执 SHA-256 `9d0bf00f65174f43b600e21e32ee41307fb81a3264b6c639a44d6c70773b89b1`。

### 1.0.9.0 测试包独立验收（本机成品通过）

冻结源码 `48fa72ab484df52d4a2fe665c78d849c95f5116b`。实际解包 Windows 壳配合同版服务，在回环 HTTPS 上验证按原文合成 AI 语音、选择只回文字、收件端气泡播放及重开重听。已授权的公开找图仅向图源替身发送公共主题；私密找图原文、可识别回声和好友附件地址均未进入模型、图源或合成请求。

混合群真人录音和收听通过。同库从 1.0.8.0 升级保留两个合成账号的登录、好友、文字、PNG、JPEG 和 WAV，迁移期间模型调用为零。成品验收使用本机 eSpeak、模型与图源替身和静音输出。真实音频设备、Azure 声线、公网及 Microsoft Store 安装和更新待验。

独立机读回执 SHA-256 `3d65594aef4bf764c6341b75136ba23a1812dcb225ff21386b12bdc0e0401089`。

## 提交给软件7与统一发行

用实际保留的产品身份填写 `store-identity.template.json` 的本地副本。用开发方批准、实际可访问的 **公网 HTTPS 同源**填 `--origin`，同时作为软件7服务的 `SOCIAL_PUBLIC_ORIGIN`。配置模板和回环不代表公网。两个独立网络上先用合成账号复查注册、互搜、接受、私聊、建群、重登和举报。当前仅有本机回环真实服务和无头 UI 证据，朋友跨网、手机或 Store 冷开均未实测。

```powershell
$operatorName = "<送审资料中的公开运营名称>"
$support = "<送审资料中的公开支持邮箱或 HTTPS 地址>"
node pack.cjs --mode store --version 1.0.0.0 --origin "<批准的 HTTPS origin>" --identity ./identity.local.json --dependency-root "../.." --source-handoff "<同批 evidence/handoff.json>" --operator-name $operatorName --support $support
```

正式包使用 Python 3.11+ 核对清单中预先冻结的 Git `source.zip`，逐项匹配本机应用构建输入，随包保留同一归档和身份。打包前的清单只需 `freeze`、`version`、`source.path` 和 `source.sha256`，打包后继续补用原清单记录包体。测试包也可传 `--source-handoff`。普通用户在「设置 → 应用更新」保存随包 ZIP，不依赖好友服务器或登录。好友页「开源与版本」显示的是服务器自己的发布身份。

Store 和测试包都排除可选 Claude Agent SDK 和它的各平台运行时，即使构建机已经安装它们。保留 Claude API 的 `@anthropic-ai/sdk`、本机 Claude 程序模式和随包许可说明。打包器在 MakeAppx 前后检查实际文件清单。也可以用 Windows 自带的 `tar.exe` 复查指定成品，命令失败时会列出不应随包的条目。

```powershell
node social/windows/pack.cjs --audit "<实际 MSIX 或本次 stage 目录>"
```

### 公开地址与同版成品检查

将 Partner Center 的 `Identity/Name`、`Identity/Publisher`、`PublisherDisplayName` 填入 `store-identity.template.json` 的本地副本，`displayName` 使用获准的商店展示名。将同一个好友 HTTPS 原点填入打包和前检的 `--origin`、服务端的 `SOCIAL_PUBLIC_ORIGIN` 和反向代理。若发行包含小星球，两条命令均传同一个世界原点 `--world-origin $approvedWorldOrigin`，并在常用的客户端网络验证世界能打开。将送审资料中同一运营名称与支持地址用于打包、前检和服务端 `SOCIAL_PUBLIC_OPERATOR_NAME`、`SOCIAL_PUBLIC_PRIVACY_CONTACT`。正式桌面包把这两个公开值写入随包配置，好友服务完全断开时也能从本机恢复区阅读和复制。测试包只提示联系发放人。

服务在获授权的地址可访问后，用 Windows 自带的 `tar.exe` 和 Node.js，从 Agent Arcade 模块根目录执行一次只读检查。

```powershell
$handoffPath = (Resolve-Path -LiteralPath "<正式成品的 evidence/handoff.json>").Path
$approvedOrigin = "<部署时独立确认的获准 HTTPS origin>"
$handoff = Get-Content -LiteralPath $handoffPath -Raw | ConvertFrom-Json
if ($handoff.origin -cne $approvedOrigin) {
    throw "交接清单的地址与获准的 HTTPS origin 不一致，已停止前检。"
}
node social/windows/check-store-release.cjs --handoff $handoffPath --version $handoff.version --origin $approvedOrigin --identity "<identity.local.json>" --operator-name $operatorName --support $support
```

使用本次正式成品的交接文件。交接包含该批冻结提交 `freeze`、`version`、已批准的 HTTPS `origin`，以及实际 `package`、`service`、`packageFiles`、`serviceFiles` 的 `path` 和 SHA-256。相对路径以交接文件所在目录为准。同批发布时两份库存的 `commit` 均须指向同一冻结源码，客户端库存使用 `verifiedFiles` 映射，服务库存使用完整的 `files` 映射。命令在联网前核对 MSIX 身份以及服务 ZIP 的完整文件清单和逐项摘要，随后以匿名 GET 核对健康端点、登录页、内容准则、隐私、公开联系方式和主要静态资源。错包、错地址、错内容和缺联系方式返回非零状态。

正式 Store 送审前检默认要求实际 MSIX 含离线求助入口及与本次参数一致的支持地址，缺少时在联网前失败。成功报告须为 `offlineSupport: matches-release-contact` 且 `storeSubmissionChecksPassed: true`，匿名隐私页也须通过同一组参数校验。已安装包的离线地址随桌面版本更新。

仅复核历史 Store 桌面与服务的配对时，可在同一命令末尾加 `--historical`。缺离线功能的旧包可在此模式报告 `legacy-no-offline-contact`，检查结果标为 `purpose: historical-service-pairing`、`storeSubmissionChecksPassed: false`。已有离线入口但配置缺失或错配时，两种模式都返回失败。测试版仍用 `--mode test`，纯服务升级仍用 `--upgrade-only`。

服务归档包含「开源与版本」时，命令还会从未登录首页验证该链接，核对服务版本页，并流式下载源码 ZIP，与交接中的 `source.path` 和 `source.sha256` 对照。报告中的 `version` 是桌面包版本，`publicSource.version` 和 `publicSource.commit` 是当前服务的发布身份。服务独立升级时，在同一命令附加 `--service-handoff "<现行服务的交接.json>"`。该文件沿用 `version`、`freeze`、`origin`、`service`、`serviceFiles` 和 `source` 字段，同源地址应和桌面包一致，服务库存的提交对应这份服务交接。

首次联网前，前检也会从实际 MSIX 读取文件清单，复用打包器的 Claude Agent SDK 排除检查，并在成功回执的 `runtimeContents` 记录结果。未签名的送审包可执行前检，实际商店签名与安装另行核实。

好友服务已有上一版时，升级前检同时传入上一份已签服务交接 `--previous-service-handoff` 和本次候选 `--service-handoff`。前检用两份交接的服务 ZIP 和逐文件摘要，将旧服务建立的合成群、登录和现有记录交给同一回环原点的候选服务。四组 HTML、JS 和 CSS 组合都须打开原群、保留并发送原草稿、由第二账号在正常页面看到原文且只入库一次。任一组合失败即退出非零，并列出出错阶段和投放资源摘要。`serviceUpgrade.status: not-run` 表示仅有本次制品和匿名检查，没有服务切换验收。发布时保留输出原文。

上线前也可单独运行这一步。使用已装根开发依赖（Playwright）、Node 24、`tar.exe` 和 Microsoft Edge。浏览器无头运行，服务和临时库仅用于本机回环。

```powershell
node social/windows/check-store-release.cjs --upgrade-only --previous-service-handoff "<上一份已签 service-handoff.json>" --service-handoff "<候选 service-handoff.json>"
```

同源 HTTPS 支持页也会匿名 GET，重定向视为失败；外部 HTTPS 只核对链接，邮箱只核对公开地址，需另行核实可访问性或收信。此项验证对外可见的版本和政策页，服务端内部进程版本、跨网账号流程、商店签名和安装仍由各自验收覆盖。隔离预览用 `--mode test --test-ca "<临时 CA PEM>"`，限定 `https://arcade-store.test:<端口>` 映射至回环，省略 `--identity`。

发布负责人另在 Partner Center 核对提交的公开受众与可搜索设置。批准公开发布后，从发行市场的普通设备在 Store 内按正式名称搜索、安装，并从「消息」创建独立的好友账号。上面的只读前检核对制品、HTTPS 和匿名服务页面。Partner Center 的受众、商店发现和实际注册由这条正式路径验证。

### 公开分发与送审

在 Partner Center 的 MSIX 提交中，打开 **Pricing and availability → Visibility**。将 **Audience** 设为 **Public audience**，将 **Discoverability** 设为 **Make this product available and discoverable in the Store**。在发行市场发布后，用户可在 Microsoft Store 按正式产品名搜索安装。好友注册面向所有用户开放，只填写应用内用户号、昵称和密码，无需邀请码、名单、朋友的个人 Microsoft 邮箱或商店链接。请朋友先体验属于体验邀请，安装与注册流程对大家相同。[微软 MSIX 可见性设置](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/visibility-options)

提交前准备正式的 Partner Center 开发者及产品身份、首发市场与价格、商店介绍和实际截图、年龄评级、公开隐私政策和支持／举报联系入口。提供可用的合成审查账号与测试步骤，在认证备注声明 `runFullTrust` 的用途，说明好友视图隔离和隐私联系的打开方式。运营方核对用户内容准则、举报处理、账号与数据处理、开源许可、对应源码和第三方通知。120 的隔离实包证据覆盖消息与「更多」往返。正式商店的公开搜索、普通新用户安装与更新，以及公开实例前检和跨网注册仍待正式环境验证。[Microsoft Store 提交流程](https://learn.microsoft.com/en-gb/windows/apps/publish/publish-your-app/create-app-submission?pivots=store-installer-msix) · [用户生成内容政策](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#1112-user-generated-content)

用实际公开 HTTPS 域名下的 `/conduct.html` 核对未登录网页与 App 内的内容准则入口，并在认证备注提供真人消息及 AI 回复的举报步骤。按 11.16，在商店详情的说明中披露实时生成式 AI，并在 Partner Center 的本次提交中标明使用实时生成式 AI，完成当次界面要求填写的声明。[实时生成式 AI 政策](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#1116-live-generative-ai-content)

商店详情可用文案：本应用包含实时生成式 AI，获用户同意并启用后，AI 角色可实时生成好友私聊或群聊回复。你可在对应消息旁举报不当回复。

### 1.0.10.0 测试包独立验收（本机成品通过）

冻结源码 `3ee7b931bc3287d5fa525463b7f20627528da792`。独立验收从实际 MSIX 解包启动隐藏 Windows 壳，验证真实角色卡导入、勾选的世界书条目、群友收件与切回原设定，也复核好友动态的访问、举报和单帖移除，以及匿名内容准则入口。回放补丁 `e4396213000155111bf526dacb4d1ca6c7f343b0` 只修正验收脚本。签回使用合成账号、临时回环 TLS 信任和模型替身，Microsoft Store 实际安装和生产公网另验。

MSIX SHA-256 `3372faab07a09c3b8a3a793f22dc97f8d39055009dbc1b9f28b43b2587d9a47c`。服务 ZIP SHA-256 `8ec8ee56fce101ace50fdbe4d5a9ceb3212ba1c32999b108bb593789dc124866`。
