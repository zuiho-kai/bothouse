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

输出 `out/<名>.<lang>.mp4`。片段之间硬切。还没渲染的片段会跳过并打印提示。

## 模板约定（写新模板必须遵守）

- 画面 1280×720（来源：`docs/launch/x-15s.md`）。
- 场景文件是 `scenes/<name>.json`。`"template": "phone"` 对应 `templates/phone.html`。
- 所有给观众看的文字写成 `{"zh": "...", "en": "..."}`。
- `render.py` 在页面加载前注入 `window.SCENE`（场景 JSON）和 `window.LANG`（`"zh"` 或 `"en"`）。模板读这两个值来播放。
- 开始播放的那一刻设 `window.__start = Date.now()`，播完设 `window.__done = true`。`render.py` 只保留这两个时刻之间的画面，所以 mp4 时长等于动画实际播放时长。没设 `__start` 就从录屏第一帧算起，片头会带上页面加载的空白。
- 消息文字里的 `@名字` 显示成 Discord mention 样式，`[[文字]]` 显示成链接样式。
- 画面里不能出现真实用户名、路径或 token。

## phone 模板的字段

- `caption`、`sub`：左侧大字和小字。大字里的 `\n` 是换行。
- `channel`：频道名。
- `me`：输入框打字后用哪个角色发出，默认 `"you"`。
- `roles`：`{ id: { name: {zh,en}, color, avatar, bot } }`。`avatar` 是一个字或 emoji。
- `steps` 按顺序播放：
  - `{"type": {zh,en}, "ms": 1100}`：在输入框里打字，打完以 `me` 的身份发出。
  - `{"say": "角色id", "text": {zh,en}}`：这个角色发一条消息。
  - `{"busy": "角色id", "ms": 500}`：显示「xx 正在输入…」（英文版是 "xx is typing…"）。
  - `{"wait": 450}`：停一会儿。
- `timing`（可选）：覆盖默认时长 `start`、`type`、`busy`、`end`。
- `clock`（可选）：状态栏时间。

## 其他模板

字段说明直接看示例场景，照抄改字就行：

- `windows`：几个 AI 窗口来回复制粘贴，示例 `scenes/x-chaos.json`。节奏在 `hopsMs` 里调。
- `wizard`：配置向导动画，界面照抄真实向导，示例 `scenes/x-wizard.json`。加角色、换 CLI 只改 `roles` 和 `clis`。
- `card`：字卡，逐行淡入，示例 `scenes/x-end.json`。B 站各段的字卡也用它。
