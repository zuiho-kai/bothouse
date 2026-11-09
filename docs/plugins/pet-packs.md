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

- 角色在插件页选的形象包（绑定里的 `avatar_pack`）决定那只的样子。`bothouse pet run` 把包转成桌宠自己的「种类」：`$DSH_HOME/dsh-pet/pet/bothouse-<包>-config.json`（动作表和这几只的位置）与 `bothouse-<包>-animation/`（每个动作一段透明 WebM）。`bothouse-` 开头的文件归 bothouse 管，每次绑定变化重写；别的种类文件不动。
- 状态到动作的对应与插件页预览同一套规则（`dshPetPlugin.tsx` 的 `PET_MATCH_RULES`，Go 侧 `cmd/cc-connect/pet_packs.go` 的 `petRules`）。
- WebP 精灵图包要先用本机 `ffmpeg`（需带 libvpx-vp9）转成透明 WebM，命令与 aboutme-pets 作者自带的 `spritesheet_to_video_pet.py` 相同；一包一百多个动作，本机 12 核约两三分钟，转好前那个角色先用默认形象。进度写在 `<DataDir>/pet/packs/<包>.json`，插件页「本地已装形象包」里显示；没装 ffmpeg 时显示原因。
- 只绑一个角色且没选形象包时与以前一样：就是原来那只 main。第一个没选包的角色用 main；所有角色都有自己的包时，main 暂时隐藏（原来的显示方式记在 `<DataDir>/pet/main-display.json`，有角色再用 main 时恢复）。
- 新加的几只与 main 同样大小、同一个角落，往里错开半只宽，互不遮挡。

## 开源展示包与导入

- 插件页「开源形象包」列出 hunmer/aboutme-pets 的 dsh1、claude、gpt、gemini 四包（`bridge/core/pet_showcase.json`：来源仓库、固定提交、每个文件的 sha256）。点「从作者仓库下载到本机」才按固定提交从 raw.githubusercontent.com 下载、逐个校验，全对才放进 `pets/<包>`；bothouse 仓库和发布页都不带素材。下载失败在卡片上写原因，不影响默认形象。
- `POST /api/v1/plugins/pets/fetch {"pack":"dsh1"}` 后台下载，进度在 `GET /api/v1/plugins/pets` 的 `showcase[].fetch`。
- `POST /api/v1/plugins/pets/import`（multipart）：一个 `zip` 文件，或浏览器选的文件夹（每个文件一段，段名 `p:<相对路径>`），可选 `name`。用上面同一个解析器检查，格式不对回一句中文原因，不留半截文件。导入后出现在每个角色的形象下拉里。

### 四个展示包的许可（2026-11-09 按固定提交核对）

| 包 | 出处 | 作者写明的许可 |
| --- | --- | --- |
| dsh1（蓝毛小女仆·新动作包） | aboutme-pets `pets/dsh1`，形象出自 PC2005-cloud/dsh-pet | 包内 NOTICE.txt：「素材: 禁止商用；二创在公开渠道须署名上述上游仓库」；LICENSE-code/assets.txt 是上游代码的 MIT 原文。上游 dsh-pet README：形象为社区二创「大肥鱼」，非 DeepSeek 官方，形象授权 CC BY-NC-SA 4.0 |
| claude / gpt / gemini | aboutme-pets `pets/<包>`，作者用 AI 生成（pets.json 描述「2026-11 Claude/GPT/Gemini 生成批次」） | 包目录里没有 LICENSE/NOTICE；aboutme-pets 仓库本身没有 LICENSE 文件；每个动作的 JSON 写着 `"License": "Non-commercial; attribution required. See NOTICE.txt and SOURCE-upstream.txt."`，但所指的两个文件在这三个包里不存在 |

结论：四包都只能非商用、须署名；claude/gpt/gemini 没有正式许可文本，再分发（转存、打进发布包）没有授权，所以只做「用户点了从作者仓库下载」。商用或转存前要先问作者。
