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

- 第一个绑定角色（按角色键排序，和以前 `/skin` 认的是同一个）用原来那只 main，只绑一个角色时与以前完全一样。其余每个角色一只：`bothouse pet run` 写 `$DSH_HOME/dsh-pet/pet/bh-<角色键>-config.json`（包内默认动画表 + 这一只，和 main 同样大小、同一个角落、往里错开半只宽），`bh-` 开头的文件归 bothouse 管，绑定变化时重写并让桌宠重载。
- 每只穿自己角色的形象：桌宠取动画时带上这只的素材根问 `/skin?pet=<id>`，按角色认内置形象（`assets/roles/skins.json` 的 aliases，见 plugins/desktop-pet/BOTHOUSE.md「形象」）。右键「换形象」选的只管 main。
- 表情图（碎碎念配图）仍只给 main 跟形象走，其余几只用默认表情图。

## 导入自己的形象包

- 插件页「导入自己的形象包」：选文件夹或 zip（本页上面两种格式）。`POST /api/v1/plugins/pets/import`（multipart：一个 `zip`，或每个文件一段、段名 `p:<相对路径>`，可选 `name`）用同一个解析器检查，格式不对回一句中文原因、不留半截文件，越界路径拒收。导入后进 `pets/<名字>`，出现在每个角色的形象下拉里。
- 给角色选上导入的包，那只桌宠就穿它：`bothouse pet run` 把包做成形象 `$DSH_HOME/dsh-pet/skins/bh-pack-<包>/`（每个动作一段透明 WebM，再按状态挑出 idle/talk/think/work/happy/surprise 六段，规则同插件页预览），`/skin` 回 `skin: bh-pack-<包>`。WebP 精灵图包要本机 `ffmpeg`（带 libvpx-vp9）转一次，命令同 aboutme-pets 作者自带的 `spritesheet_to_video_pet.py`，用 untile 一次切开；转好前和转失败时那只先穿角色的内置形象。进度在 `<DataDir>/pet/packs/<包>.json`，插件页已装包卡片上显示，没装 ffmpeg 会写原因。
