# 能力与验证状态

2026-10-23：下载入口收敛为 Mac universal dmg 一份、Windows x64 exe 一份、Linux x64/arm64 两份；安装和自更新按相同命名并校验 SHA256SUMS。Go 沙箱全量、CUJ、回归、vet、actionlint、shell 语法及 Linux 安装测试通过；v0.1.2 发布替换与 Mac 验收以 /tmp/rename/result4.md 为准。

2026-10-22：产品入口统一改名 bothouse，配置支持新目录优先/旧目录回退；平台原生发布流程与 SHA256SUMS 已实现。沙箱 Go 全量、CUJ、前端及静态检查通过。v0.1.2 的发布、真机验收与未验项以本轮交付记录 /tmp/rename/result.md 为准；未部署生产 bot。

2026-10-22 Issue #50：新增可直接下载的 Windows exe、macOS Bothouse.app/dmg、Linux 裸二进制及 SHA256SUMS，保留旧包更新兼容；v0.1.1 用 681dc94 源码补传。macOS arm64 已经 open 启动并验证浏览器 /setup 与 API；两个 dmg 的更新提取已验。Go 沙箱全量 48 包、CUJ、回归及 vet 通过。Windows PE/交叉构建已验，真实 Windows 执行与桌面双击、本机签名／公证未验；最终发布和 main 记录见 `/tmp/rename/result.md`。历史准备记录如下。

本页只记录 bothouse 软件仓库的能力边界。源码存在不等于已发布安装包，旧实例可用不等于新用户从零安装已经验收。
2026-10-21 #229 / PR #230：DSH原生「频道」入口已实现，使用collab同源API/SSE，展示配置频道、消息、成员和工作状态。前端11项、后端15项、DSH完整类型检查及插件构建通过，8项数据源回归纳入CI。用户此前确认页面正常，本轮未重新完成浏览器验收；真实DeepSeek回复与gate自动补历史待验证。创建/管理频道、@菜单、手机切频道与历史翻页未做；未合并、未部署。详见[安装和验证](../dsh/collab/README.md)。

2026-10-21 Issue #213：肥鱼12:10现网v3日志为补答格式失败后超时，旧修复已部署。v4改为单一结构化答复schema，在插件内验证后转Text，不进入工具执行器；原模型/历史、两次60秒、失败与推理边界保留。新增回归旧版3红、修后真实运行时契约67项通过，真实历史隔离回放已走通，最终证据及部署见PR。单一Codex实现/自查，未宣称供应商故障消失。详见[公开答复出口](../integrations/dsh-public-output/README.md)。

2026-10-21 #208：普通 Codex 对话中，明确的公开 commentary 立即发送；工具后的新文字恢复独立预览并原地收尾。插话后的回复不再必须等下一工具或任务结束，原任务继续。适配器与真实 Engine 链路、STREAM2 CUJ 覆盖，新旧差分已复现；完整测试与部署结果见PR，真实频道尚待验收。详见[说明](CODEX_INSERT_PUBLIC_REPLY.md)。

## 2026-10-21 接续开源准备

| 项目 | 当前证据 | 缺口 |
| --- | --- | --- |
| 软件仓库 | 私有仓库 zuiho-kai/bothouse 已建立，安装脚本和更新地址指向它 | 尚无 Release，不能称为一行命令安装已通过 |
| 自建平台向导 | 本分支同步 conest #8/#9 的点名 ID、交回队长和人设队伍行；补旧队长 ID 改动后的旧队员交回回归 | 待审核、合并；新安装包和真实模型闭环未重验 |
| MIT 与中英首页 | 本分支采用 MIT 和软件定位，中英首页指向新仓库 | 待审核、合并 |
| 宣传片 | X 与 B 站只有脚本草稿 | 等用户看稿后才制作 |
| Windows 桌面 | 原仓库有 Windows 构建/测试记录 | 真实桌面的窗口行为尚未验证 |

## 从原仓库带来的软件能力

以下来自原仓库的实现和验证记录，本轮未逐项重新验收：

- Discord 多角色的点名、上下文、自动交回和队友状态，协议见 [团队协作](../bridge/MAOMAO.md)。
- 自建网页频道的 WebSocket 接入、点名和交回，见 [cloud-web 协议](../bridge/docs/cloud-web.md)。
- 飞书单角色向导与 CLI 配置，见 [接入说明](connect-discord-feishu.md)。
- gate 判断与 wiki 检索/整理是可选组件，安装见 [ccm 和 wiki](ccm-and-wiki.md)。
- 会话恢复、权限代批、公开进展和任务卡分别见 [会话适配代码](../bridge/agent/acp/)、[代批说明](DELEGATED_PERMISSIONS.md)、[公开进展](PUBLIC_PROGRESS.md)。
- 电脑语音与活动模块保留，其独立部署记录不代表基础向导已自动配置。

DSH 作为智能体可经 ACP 接入；DSH 网页作为聊天入口仍是后续工作。

测试与新入口核验结果随本次 PR 更新，部署记录见 [HANDOFF.md](HANDOFF.md)。
