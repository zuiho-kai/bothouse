# 宣传片动画

一个镜头 = 一个场景 JSON + 一个模板 HTML。Playwright 播放模板并录屏，ffmpeg 转成 mp4。中文版和英文版用同一份 JSON。

## 改台词

只改 `scenes/<名>.json`，不用碰模板。所有给观众看的文字都写成 `{"zh": "...", "en": "..."}`。

## 加镜头

复制一个现有的 JSON，改名，然后改内容。`"template"` 决定用哪个模板。

## 渲染

```sh
export https_proxy=http://127.0.0.1:7890   # 首次下载浏览器要走代理
uv run --with playwright playwright install chromium   # 只需一次
uv run --with playwright python docs/launch/anim/render.py              # 全部场景，中英各一份
uv run --with playwright python docs/launch/anim/render.py x-team --lang zh
```

输出在 `out/<场景>.<lang>.mp4`。`out/` 不进 git。模板文件还不存在的场景会被跳过。

## 拼成片

剪辑表放在 `cuts/<名>.json`，按顺序列场景：

```json
{ "clips": [ { "scene": "x-chaos" }, { "scene": "x-team", "speed": 1.5 } ] }
```

`speed` 是这一段的倍速，默认 1。先渲染片段，再拼：

```sh
uv run --with playwright python docs/launch/anim/render.py
python3 docs/launch/anim/cut.py                # 全部剪辑表，中英各一份
python3 docs/launch/anim/cut.py x-15s --lang en
```

输出 `out/<名>.<lang>.mp4`。片段之间硬切。还没渲染的片段会跳过并打印提示。参数也可以直接给一个 `.json` 路径，临时剪辑表不用放进 `cuts/`。

### 旁白、字幕、音乐

```json
{
  "music": { "file": "music/Digital_Lemonade.mp3", "credit": "\"Digital Lemonade\" Kevin MacLeod ..." },
  "clips": [ { "scene": "v2-pain", "vo": "vo/zh/01.wav", "sub": "开了四个 AI，同一段背景，要讲四遍。" } ]
}
```

- `vo`：这一镜的旁白音频，路径相对 `anim/`。旁白在镜头开始 0.3 秒后进来。
- 每镜时长 = 旁白时长 + 1 秒留白。画面比这短，就停在最后一帧补齐；画面更长，就按画面原长。没写 `vo` 的镜头按画面原长。
- `sub`：字幕文字，烧在底部居中，白字加半透明黑底条。按句号、问号、叹号拆句，一句一屏，时长按字数分配到本镜旁白里。一行最多 16 字，超长优先在标点后断行。没写 `vo` 时字幕占满整镜。
- `sub` 写成列表时每项一屏；每项也可写成 `[文字, 旁白内起点秒]`，按实测时刻换屏（v4c 镜7 用：一句旁白挂一个画面，按字数分会和画面错开）。
- 字体用冬青黑（Hiragino Sans GB）。规格写的是 PingFang SC，但 macOS 26 的 PingFang 文件 libass 读不了，会显示方块。
- `music`：全片铺满，短了自动循环。第 1 镜压到氛围音量，第 2 镜起恢复；有旁白时自动压低（sidechaincompress），旁白段音乐比人声低约 12 dB；片尾 1.5 秒淡出。旁白和音乐先各自统一响度（旁白 -16 LUFS，音乐 -20 LUFS）。
- `credit`：署名文字，脚本不使用，给片尾字卡照抄。音乐来源和许可证见 `music/SOURCES.txt`。
- 字幕文件同时写到 `out/<名>.<lang>.ass`，方便检查。

## 模板约定（写新模板必须遵守）

- 画面 1280×720（来源：`docs/launch/x-15s.md`）。
- 场景文件是 `scenes/<name>.json`。`"template": "phone"` 对应 `templates/phone.html`。
- 所有给观众看的文字写成 `{"zh": "...", "en": "..."}`。
- `render.py` 在页面加载前注入 `window.SCENE`（场景 JSON）和 `window.LANG`（`"zh"` 或 `"en"`）。模板读这两个值来播放。
- 开始播放的那一刻设 `window.__start = Date.now()`，播完设 `window.__done = true`。`render.py` 只保留这两个时刻之间的画面，所以 mp4 时长等于动画实际播放时长。没设 `__start` 就从录屏第一帧算起，片头会带上页面加载的空白。
- 消息文字里的 `@名字` 显示成 Discord mention 样式，`[[文字]]` 显示成链接样式。
- 画面里不能出现真实用户名、路径或 token。

## 公共叠加层 common.js

模板用 `<script src="common.js"></script>` 引入，开播（设 `__start` 时）调 `BH.overlay()`。它读场景里这几个字段：

- `headline`：`{zh,en}`，画面中上方大字卡，粗体，4–8 字，弹出后停住。
- `headline_at`：大字卡出现的毫秒数，默认 300。
- `brand`：`true` 时左上角显示小号 bothouse 标志，全片同一样式。

底部 80px 留给后期烧字幕，模板和叠加层都不往那里放东西。`BH.t(v)` 取双语字段的当前语言。

## phone 模板的字段

- `caption`、`sub`：左侧大字和小字。大字里的 `\n` 是换行。
- `channel`：频道名。
- `me`：输入框打字后用哪个角色发出，默认 `"you"`。
- `roles`：`{ id: { name: {zh,en}, color, avatar, bot, tag } }`。`avatar` 是一个字或 emoji。`tag`（可选，`{zh,en}`）是名字旁的小名牌，如「Claude Code」。
- 有 `headline` 时左侧 `caption` 不显示，手机缩小。
- `zoom`（可选，默认有 `headline` 时为 `true`）：放大镜模式。手机放在左侧约 1/3，对话贴顶。右侧每来一条消息就弹出它的放大卡片（约 2 倍字号），旧卡片上移变淡，最多留 3 张。`badge` 同时出现在右侧最新卡片下。`wiki` 卡片出现时右侧放大卡片淡出让位。没有 `headline` 的旧场景不受影响。
- `steps` 按顺序播放：
  - `{"type": {zh,en}, "ms": 1100}`：在输入框里打字，打完以 `me` 的身份发出。
  - `{"say": "角色id", "text": {zh,en}}`：这个角色发一条消息。
  - `{"busy": "角色id", "ms": 500}`：显示「xx 正在输入…」（英文版是 "xx is typing…"）。
  - `{"wait": 450}`：停一会儿。
  - `{"badge": {zh,en}}`：在最后一条消息下弹出绿色 PR 徽章。
  - `{"wiki": {"title": {zh,en}, "lines": [{zh,en}, ...]}}`：从右侧滑入一张 wiki 页面卡片。某行写 `"hi": true` 就高亮这行，没写就高亮第一行。
- 新消息弹簧弹出，最新一条短暂高亮。
- `timing`（可选）：覆盖默认时长 `start`、`type`、`busy`、`end`。
- `clock`（可选）：状态栏时间。

## 其他模板

字段说明直接看示例场景，照抄改字就行：

- `windows`：几个 AI 窗口来回复制粘贴，示例 `scenes/x-chaos.json`。节奏在 `hopsMs` 里调。
- `wizard`：配置向导动画，界面照抄真实向导，示例 `scenes/x-wizard.json`。加角色、换 CLI 只改 `roles` 和 `clis`。
- `card`：字卡，逐行淡入，示例 `scenes/x-end.json`。B 站各段的字卡也用它。
