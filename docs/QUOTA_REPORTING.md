# 回复额度查询

对应 Issue #13、#28。PR #18 的真实额度查询已于2026-10-16部署；后续失败回复尾注修复的发布与真人验收状态见 [交接](HANDOFF.md)。

## 展示口径

回复中的“额度剩余”来自服务商账户接口，表示当前模型所属套餐/配额池的剩余比例，按整数四舍五入。它不是上下文剩余、现金余额或剩余消息次数；按量付费可能允许套餐用完后继续使用。

上下文与额度可同时显示。没有接口、接口未给数据、查询失败分别显示明确状态，不补出百分比，也不在缓存过期后拿旧成功值冒充当前余额。多个时间窗口同时约束时显示最紧张窗口；/usage 可查看窗口及重置时间。

状态栏查询最多等待 3 秒，缓存 30 秒。核心缓存区分 Agent 实例和本条回复的模型；已有会话仍使用旧模型时，不用待切换的新默认模型查询。

失败回合也展示模型及额度：额度是账户状态，不代表本轮任务成功。错误标记和后端返回的内容仍保留，不自动重试，也不将失败答案写入成功历史。长错误消息只在最后一段附尾注；富卡片已成功展示额度时不重复添加，卡片更新失败时回退到文字尾注。原有状态栏总开关与模型/上下文显示开关仍生效。

## Cursor

- 支持原生 Cursor 适配器，以及 auth_method = "cursor_login" 的 ACP。其他 ACP 后端不会误查 Cursor 账号。
- 查询 Cursor 客户端自己的 DashboardService/GetCurrentPeriodUsage，固定使用 api2.cursor.sh，不提交推理请求。协议依据本机官方 Cursor CLI 2026.04.29-c83a488 的客户端及 protobuf 定义，并已用当前账号验证。
- macOS 读取当前用户钥匙串的 Cursor 登录；文件登录态按 CLI 的 macOS/Linux/Windows 路径读取。项目指定不同 HOME 时不借用当前用户钥匙串。API key、自定义 API 域名不套用个人订阅额度。
- 以响应 autoBucketModels 为准选择 Auto/API 额度池，不硬编码哪些模型免费，也不使用混合百分比。模型标识后面的参数不参与池匹配。
- 遵守项目代理环境变量；没有代理环境变量时，在 macOS 读取系统 HTTPS 代理。PAC/认证代理与企业 teamId 尚未验证。

## 大豆包 / Antigravity

- 当前生产使用 stream_json = true。查询该会话自己启动的 agy 的 LanguageServerService/RetrieveUserQuotaSummary；CLI 负责既有登录与令牌续期，不自行复制 Google OAuth 客户端秘密。
- 每个进程设置独立随机 CSRF 凭据；通过 lsof -nP 只发现本进程 PID 的 loopback 监听端口。RPC 不经代理、不跟随重定向，进程退出后失效。macOS 自带 lsof，其他系统需提供该命令；Windows/旧非 stream-json 传输没有本轮实机验证。
- 区分 Gemini、Claude/GPT 共享池，以及 Pro 账号的 Argon 独立周额度；CLI 没有单列 Argon 时使用 Gemini 共享池。未知模型/缺失数值不猜测额度。
- 采用本地接口的原因：本机原生 CLI 给出 Argon 独立周额度，而用旧云端调用方式取得的汇总漏掉该分组；磁盘 OAuth 文件也可能落后于钥匙串。直接套旧接口会显示错误余额。
- 当前实际运行会话直接提供额度；尚未启动会话或会话已关闭时显示暂无数据，不额外启动模型任务。/usage 的 Agent 级查询使用最近启动且仍存活的 CLI；每条回复优先读取其自身会话。

## 验证与维护

默认测试使用合成数据与模拟服务，覆盖模型池、零值/缺失值、周额度、错误/重定向、代理、缓存和关闭。真实接口验收必须显式启用：

~~~sh
cd bridge
CC_CONNECT_LIVE_CURSOR_MODEL='准确模型标识' go test -tags no_web ./internal/accountquota -run TestCursorQuotaLive -v -count=1
CC_CONNECT_LIVE_AGY='/实际路径/agy' go test -tags no_web ./agent/antigravity -run TestAntigravityQuotaLive -v -count=1
~~~

后者启动一个隔离的空闲 CLI 查询账户元数据，然后关闭它；不发送用户提示、不生成模型回答、不接触生产进程或 Discord。只输出额度分组、百分比和重置时间，不输出账户标识或凭据。普通 CI 跳过这两个验收。

两种接口均是客户端内部接口，升级 CLI 后须复核。若协议改变，保留明确查询失败/暂无数据提示，更新合成回归数据；不要通过读取聊天里的自述或推算 token 来补余额。
