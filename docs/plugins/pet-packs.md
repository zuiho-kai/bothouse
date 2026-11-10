# 本机形象包接入

插件页从产品数据目录的 `pets/<包名>/` 读取素材；数据根沿用启动入口传入的 DataDir，不另找 HOME。没有包时显示空列表，未绑定角色显示「形象待接入」。bothouse 不内置、不镜像第三方形象。

- `GET /api/v1/plugins/pets`：管理 API 的 `{ok,data}` 包装，data 含 `baseDir` 和 `installed`。每个包有 `id/name/format/localPath/actionCount/actions`；坏包仍列出 `error`，但没有可播放动作。
- `GET /api/v1/plugins/pets/asset?pack=<包名>&file=<相对文件名>`：沿用管理 token，浏览器用现有 token 查询参数。仅开放 PNG/JPEG/WebP/GIF/WebM，扩展名须与文件头一致；文件和包目录的链接不能逃出打开的根目录。
- 角色绑定由 `GET/PUT /api/v1/plugins/role-bindings` 保存，事件由 `/api/v1/roles/events` 推送，详见同目录 `role-events.md`（配套角色接口 PR）。表格与桌宠卡片共享绑定，显式解绑不会回退默认包。

WebP 精灵图包包含 `manifest.json`、`actions.json` 和本机素材。动作优先读 actions.json，仅当它不存在才读 manifest 的 animations。支持 `sources.webp` 与 `spritesheet.{frameWidth,frameHeight,columns,frameCount,fps}`，或同名扁平字段；帧尺寸与速度均来自包。归一化格式名为 `webp-sprite`。

dsh-pet 透明 WebM 包可用 `main-config.jsonc`、`assets/config.jsonc`、`dsh-pet/assets/config.jsonc`、`config.jsonc`，或 `pet/<种类>-config.json/jsonc`；种类配置两种后缀均支持 JSONC。主配置的素材依次从 main-animation/webm 与相应 assets/webm 查找，种类素材从 pet/<种类>-animation 查找。动作文件名来自 animations 配置；idle、events.whisper 和 events.workStatus 的档位分别映射为空闲、说话和上游工作状态。显式 state 优先于名称匹配。

归一化动作含 `id/name/file/state?`；精灵图另含帧尺寸、列数、帧数和 fps。播放器一次只露一帧，切动作或素材后清掉前一次加载错误。页面模拟事件按角色隔离，恢复实时会采用最新后端状态。

本次 Mac 验证使用隔离管理 HTTP 服务、配套角色接口候选和本机 dsh1/claude 素材的只读副本。浏览器已验的状态来自内存角色夹具，不代表线上 DSH 插件已接入。社区插件的安装、实际运行、接收角色事件须分别验收；保存角色绑定本身不会改变上游插件行为。

## 一个角色一只桌宠（#549）

`bothouse pet start` 起的桌面桌宠按角色分：插件页给几个角色打开桌宠，桌面上就有几只，每只只跟自己的角色动（`/work-status?pet=<id>`，桌宠 fork 里新加的按宠物状态槽），气泡、右键「对话」「碎碎念」也只找自己的角色；「查看余额」在团队总量后面列出每个绑定角色今天的用量。

- 第一个绑定角色（按角色键排序，和以前 `/skin` 认的是同一个）用原来那只 main，只绑一个角色时与以前完全一样。其余每个角色一只：`bothouse pet run` 写 `$DSH_HOME/dsh-pet/pet/bh-<角色键>-config.json`（包内默认动画表 + 这一只，默认 260、和 main 同一个角落、往里错开半只宽），`bh-` 开头的文件归 bothouse 管，绑定变化时重写并让桌宠重载；用户改过的大小和位置重写时保留。
- 大小：包内默认改成 260（上游 462）。每只在桌宠上右键「大小」选 小 200 / 中 260 / 大 360，写回这只自己所在的配置（`POST /pet-size {id, size}`），桌宠重建窗口生效。
- 内存（Mac 实测，整棵进程树 RSS：`pet run` + node 宿主 + Electron 主进程与各 helper）：1 只约 500 MB，3 只约 770 MB。几只共用一个 Electron 和一个宿主，每多一只多一个窗口渲染进程，约 130–140 MB。
- 每只穿自己角色的形象：桌宠取动画时带上这只的素材根问 `/skin?pet=<id>`，按角色认内置形象（`assets/roles/skins.json` 的 aliases，见 plugins/desktop-pet/BOTHOUSE.md「形象」）：C酱（cjiang）＝橘、肥鱼（deep）＝鲸鱼娘、G哥（gge）＝龙娘。右键「换形象」选的只管 main。
- 表情图（碎碎念配图）仍只给 main 跟形象走，其余几只用默认表情图。

## 开源展示包与按需下载


- 插件页「开源形象包」列出 hunmer/aboutme-pets 的 dsh1、claude、gpt、gemini 四包（`bridge/core/pet_showcase.json`：来源仓库、固定提交、每个文件的 sha256）。点「从作者仓库下载到本机」才按固定提交从 raw.githubusercontent.com 下载、逐个校验，全对才放进 `pets/<包>`；bothouse 仓库和发布页都不带素材。下载失败在卡片上写原因，不影响默认形象。
- `POST /api/v1/plugins/pets/fetch {"pack":"dsh1"}` 后台下载，进度在 `GET /api/v1/plugins/pets` 的 `showcase[].fetch`。


### 四个展示包的许可（2026-11-09 按固定提交核对）

| 包 | 出处 | 作者写明的许可 |
| --- | --- | --- |
| dsh1（蓝毛小女仆·新动作包） | aboutme-pets `pets/dsh1`，形象出自 PC2005-cloud/dsh-pet | 包内 NOTICE.txt：「素材: 禁止商用；二创在公开渠道须署名上述上游仓库」；LICENSE-code/assets.txt 是上游代码的 MIT 原文。上游 dsh-pet README：形象为社区二创「大肥鱼」，非 DeepSeek 官方，形象授权 CC BY-NC-SA 4.0 |
| claude / gpt / gemini | aboutme-pets `pets/<包>`，作者用 AI 生成（pets.json 描述「2026-11 Claude/GPT/Gemini 生成批次」） | 包目录里没有 LICENSE/NOTICE；aboutme-pets 仓库本身没有 LICENSE 文件；每个动作的 JSON 写着 `"License": "Non-commercial; attribution required. See NOTICE.txt and SOURCE-upstream.txt."`，但所指的两个文件在这三个包里不存在 |

本项目按这些说明仅提供个人非商用的按需下载入口，不把缺少许可文件解释为获得了再分发授权。素材不会打入仓库或安装包；商用或再分发前应先向作者取得相应授权。

下载完成后可在插件页选择并预览。桌面每角色一只的内置形象与布局沿用现有实现；本轮不引入形象包导入或精灵图转桌面视频。
