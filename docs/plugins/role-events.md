# 给插件接角色状态

bothouse 提供角色事件和角色绑定；DSH 仍负责插件安装、加载和全局开关。这里不内置形象素材，不把上游插件自动改造成多角色插件。

## 订阅

GET /api/v1/roles/events 返回 SSE，沿用管理 API 的 Bearer token；浏览器 EventSource 可用既有 token 查询参数。先监听 snapshot，再监听 idle、working、thinking、celebrate、error、speech。

- snapshot：{roles: [...], dsh: {status, error?}, time}。首次连接和每次重新连接都先返回全部已知角色；角色增删或 DSH 可用性变化也会补快照。
- 角色：role_key、source、name、display_name、online、status、busy_count、sessions。角色键固定为 bridge:项目名 或 dsh:成员ID；显示名字不能当键。
- sessions：每项含 session_key、status、busy。桥接用现有会话键；DSH 用房间 ID，只有 presence 时沿用其 busy_chat 标签（缺失时为空），不能当作稳定会话 ID。
- 增量：{type, role_key, session_key, status, time, role}；speech 另带 text，DSH 实际消息还带 message_id、revision、category，未定稿的流式回复带 draft，改写本连接已发过的那条带 update。time 为 RFC3339 UTC。status 是此次会话状态，role.status 才是多开合并后的角色状态；仅聚合变化时 session_key 为空，详情看 role.sessions。
- idle 空闲，working 干活，thinking 思考，celebrate 完成，error 出错，speech 角色说的话（桥接为最终回复，DSH 为房间里的消息，流式期间先发未定稿版本，还会更新）。思考正文不外发，桥接 NO_REPLY 不转成气泡；这些事件不承诺消息已在外部平台送达。界面卡片不算说话，见下条。
- DSH 一条消息从草稿、逐段改写到提交始终是同一个 message_id，revision 随正文改变（以秒为单位的浮点时间戳、含毫秒精度，只能比大小、不能当序号，也不能按毫秒解析），category 为 draft 表示还在流式生成、reply 表示已定稿，draft 字段同时标出未定稿。消费方按 message_id 替换同一条气泡，不要按事件条数追加；update 为 true 表示这是本连接已发过的那条消息的改写。同一连接里 revision、正文和定稿状态都没变的重复帧才丢弃；草稿转定稿即使 revision 与正文都没变（上游同毫秒提交）也照发，并带 update。这份「本连接已发过什么」的记录按连接生命周期只增不减、重连即清空。
- DSH 的进度卡、授权卡、任务卡是房间内的界面元素，不是角色说的话，一律不转成 speech。判卡只看 card 字段是否非空（null 或缺失即不是卡），不要按作者判断——授权卡、任务卡同样以角色身份发出；也不要用顶层 kind 判卡，顶层 kind 保留给任务板事件。
- 删除边界：上游撤回或回滚一条消息时会发删除帧（hub.mjs 的 type:'deleted'），当前转接层只认成员、房间、消息三种帧，删除帧未转接。因此已作为草稿发出去的 speech 若被这一轮回滚，消费方收不到收回通知，需要自己处理残留气泡；这里不承诺自动收回，也不靠重连纠正。

一个角色开多处，按 error > working > thinking > celebrate > idle 合并。busy_count 是忙的不同会话数，页面显示“N 处在忙”；相同会话不重复计数。DSH 的 thinking 房间集合可数多处，只有单份 presence 时只能确认一处，不推测额外会话。完成/错误是瞬时事件，之后按真实会话忙闲恢复；DSH 自身报告的成员错误会保留至上游清除。

中继和任务这类一次性的活在快照里各自是一份工作，键形如 项目:relay-work-N。它的角色事件也用这个键，所以一次活只算一处忙：事件换了键会多算一份，恢复正常后自行消失（不是永久卡忙），但这段时间页面会短暂多显示一处。

桥接事件实时推送，忙闲另沿用 DSH presence 的两秒刷新周期核对。DSH 事件通过现有原生 SSE 转接，断开后按现有 DSH 三秒读取超时重试并重取状态。DSH 不可用时 dsh.status 为 stopped/error，已有 DSH 角色是最后已知状态，不能当作仍在线。客户端应显示不可用。没有历史事件重放；重连用快照替换角色集合，清理旧会话，避免重放旧气泡。慢订阅者会断开并重取快照。

## 给每个角色保存插件和形象

GET /api/v1/plugins/role-bindings 沿用管理 API 的 {ok, data} 包装；data 的格式如下。PUT 同一路径提交这个对象，全量替换并返回保存结果：

    {"bindings":{"bridge:deep":[{"plugin_id":"已装插件的名称或ID","enabled":true,"avatar_pack":"本机包名"}],"dsh:deep":[{"plugin_id":"已装插件的名称或ID","enabled":false}]}}

plugin_id 建议用真实插件列表中的 package name（plugins[].name）；调用方使用 DSH 插件行时，也可原样保存 rows[].id，消费方须一致。avatar_pack 可省略。这里只保存绑定，不检查包是否已装，也不加载素材。去掉角色、去掉某个插件或给角色空列表即解绑；{"bindings":{}} 全部解绑，没有默认回落。记录原子写入 bothouse 数据目录的 plugins/role-bindings.json，刷新和重启后保留；损坏文件返回错误，不伪装成空绑定。

enabled 是角色自己的开关，DSH 全局启用状态仍由原有插件接口管理。插件或网页消费方需读取绑定，仅处理自己启用的角色；未绑定的角色不自行补配。PUT 需已配置且通过管理 token 验证。已有 DSH 插件必须接入上述接口才会收到角色状态；本次未改 DSH 或替上游插件注入事件。

## 兼容性实测边界

| 对象 | 能装 | 能跑 | 能收角色事件 |
| --- | --- | --- | --- |
| 本次隔离 HTTP 订阅器 | 不适用 | Mac 针对性测试通过 | 首帧、重连、思考、说话、交活、空闲已验；DSH 用本地原生协议桩验证，含草稿→改写→提交同一条消息、进度卡不成 speech、中继忙只算一处 |
| DSH 社区桌宠、人格等插件 | 本次未验 | 本次未验 | 本次未验；需要插件或适配器订阅，不能凭接口就宣称兼容 |

本次没有安装社区插件、连接生产 DSH、部署或重启。接口测试不替代后续发布包与真实插件验收。
