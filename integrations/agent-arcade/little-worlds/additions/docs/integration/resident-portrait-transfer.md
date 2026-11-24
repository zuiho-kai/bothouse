# 房主公开居民头像的接线契约

适用于已有房主连接。世界端用 `withResidentArt(db, planetResidents(db))` 包装现有服务。原连接码、实例和获准居民的来源判断不变。原快照的 bridge 居民可额外带 `portrait`：缺省沿用内置 sprite 表；null 表示缺失或未获准，无图时显示原名字与状态；对象含 `sha256, pack, author, license`。摘要计算的是清除附带信息后的静态 PNG。禁止用其他主机的同名静态头像补空。

- 软件3发布端和 Windows 宿主共用 `scripts/resident_portraits.py` 的 `publish_current(publisher, config, selected, friends, world, token, *, approvals=(), expected_instance=None, stopped=None)`。publisher 使用原 `publish-residents.py` 的 globals 或现有 runpy 字典，world 使用原 origin() 结果。宿主继续传预览过的实例指纹和原停止事件。它从已过 ACL 的角色读取准确外观，传图前重新核对名录。原 feed 回执的 missingArt 决定需要单独上传哪些 PNG，普通心跳无需重复向世界发图。
- 软件3服务端：原 JSON feed 和 roster 路由使用包装返回的同名方法。把新增两个 HTTP 路径交给 `serveResidentArt`；使用现有 cookie 解出的 viewer ID。它处理 PNG 限额、绑定发布端、访客着陆检查，读回只限当前绑定。认证或换装后旧图片地址失效。
- 软件6渲染端：`residentPortrait(planet, resident)` 返回 undefined 时走内置 sprite；null 时走无图；有值时按单帧显示返回的同源 URL，并提供其 credit 文字。刷新时比较摘要、署名与许可；换星球或异步结果迟到沿用现有 visit 守卫。
- 已启用包中未隐藏的头像，包清单明确声明 CC0-1.0 或 CC-BY-4.0 且提供公开作者时，可随已批准的角色发布。其他自定义图可使用房主已有的逐图授权，记录须同时匹配 instance、project、slug、pack、sha256，并带 author、license。已有包署名和许可优先保留。库中实际素材来自本机固定的 `/api/v1/library/avatar-image/<slug>`；管理接口返回的 URL 只比较修订，不跟随。头像目前支持 1024 像素以内、2 MiB 以内、非交错静态 PNG，每个绑定来源最多 32 MiB。图片文本、EXIF 等随图字段在发布端丢弃。未提供文件型授权的个人 mine 包若无已声明的公开许可，保留无图。

服务路由：在现有 API 处理器解析 cookie 后，调用 `if (await serveResidentArt(req,res,url.pathname,id,service)) return;`。二进制 POST 位于 `/api/resident-feed/art/<居民号>/<sha256>`；GET 位于 `/api/planets/<星球>/residents/<居民号>/art/<sha256>.png`。不要把认证头或图像记入业务日志。读取响应中的 portrait 附有原装扮 slug；有自定义图或明确无图的居民对旧客户端返回 appearanceKey=default，避免同名误配。保留来源的可见文字为「包/装扮 · 作者 · 许可」。

独立复跑（Node 24、Python 3.11）：从本工作树执行 `node scripts/verify-resident-portrait.mjs <一个尚不存在的输出目录>`。两个合成 Bothouse 管理端、两份合成配置、真实快照投影和世界居民服务经回环 HTTP 收发，读回三个访客 PNG、解压像素并比较。星球会话与着陆位置由夹具建立；最终三维客户端、公开部署和房主实机仍需由集成方验收。
