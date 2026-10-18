# 共栖圆屏 UI 原型

本目录保存「共栖 · CoNest」实体圆屏设备的浏览器交互原型，供设计与研发审核、迭代。跟踪 [Issue #53](https://github.com/Zssan12/conest/issues/53)，当前草稿 PR 为 [#54](https://github.com/Zssan12/conest/pull/54)，硬件闭环仍看 [#42](https://github.com/Zssan12/conest/issues/42)。这是电脑浏览器里的独立交互模拟，不是固件或已接通的生产语音界面。

**最新进展（2026-10-18）：已将新高清视频素材接入 466×466 圆屏推荐方案，替换此前放大 2.9 倍导致模糊的 192×208 旧图集。** 见[素材清单、视频与抽帧预览](assets/characters/README.md)与[高清素材交接](ASSET_BRIEF.md)。

![466×466 实际尺寸与 1.35× 放大查看的浏览器实测截图](preview.png)

## 现有界面最影响体验的 3 个问题与本轮改法

1. **人物模糊、边缘与背景割裂（看清伙伴）**
   - **原问题**：旧版把 `192×208` 全身小帧放大约 2.9 倍做大头裁切，面部与发丝明显像素化；同时新视频中部分素材带内嵌圆形底盘或半身横切线，若统一缩放会露出硬边。
   - **改法**：改用 `720×720` / `544×544` 高清视频素材，建立**逐角色、逐动作校准表**（`scale / tx / ty / bg`），例如 G哥待机取 `idle-blink-square-v1.mp4` 放大 `1.18×` 将底部横切线推到圆屏外并完整保留龙角、尖耳与发饰；叠加圆周径向柔化层消除矩形框感。
2. **上下四层文字/按钮常驻堆叠，挤压人物脸部（理解状态）**
   - **原问题**：旧版在圆屏内同时常驻顶部连接文字、大号角色胶囊、底部「我在」状态框与「按住说话」大按钮，纵向占去约 40% 画面，压住额头与胸口。
   - **改法**：收敛为**单一推荐头肩特写方案**。顶部合并为一枚极简身份徽章（`● G哥 ⚙`），待机时隐藏冗余状态框、仅在底部弧区保留低干扰的 `按住说话` 胶囊；仅在倾听、思考、回答、忙碌、离线等非待机阶段按需浮现简明状态胶囊与细微状态光环。
3. **停止入口缺少竞态保护、旧沙箱外壳阻碍视频加载，且状态流转依赖假定时器（方便交互与真实对接）**
   - **原问题**：旧版采用 `thinkingTimer = setTimeout(..., 1500)` 伪造 1.5 秒后由思考切入说话，与真实语音生命周期脱节；点击停止若未失效旧计时器，迟到回调可能把界面重新拉回说话状态；此外旧 `preview-shell.html` 沙箱阻塞本地视频加载。
   - **改法**：**彻底移除 1.5 秒假计时器**，UI 状态流转全面接入真实语音生命周期：按住说话采集或开始录音 → `listening`；松开提交或等待回答/合成 → `thinking`（绝不自动跳转）；首块真实音频出声播放（`<audio id="cn-voice-audio">` / `DeviceQueuePlayer` `playing` 事件）→ `speaking`；音频完整播放完毕（`completed`）或停止释放后回到 `idle`；服务忙（409）→ `busy`；合成/请求失败 → `error`；服务断开 → `offline`。引入单调递增 `sessionSeq` 会话令牌与双缓冲 `<video>` 交叉淡入，点击停止立即切入 `stopping`，结合 PR #61 的 `device_released` 释放合同与全局空闲判定安全回到 `idle`。

## 先看效果

在仓库或工作区根目录运行（只需 Python 3，不安装应用依赖）：

```sh
python3 -m http.server 58249 --bind 127.0.0.1 --directory prototypes/device-ui
```

浏览器打开 <http://127.0.0.1:58249/>（端口占用时换一个空闲端口）。

- **预览视图切换**：默认同屏展示 **1:1 硬件实际尺寸（466×466 px）** 与 **1.35× 放大查看（629×629 px）**；可在顶部切换为「仅 466×466」「仅 1.35× 放大」或「修改前后对比（新高清视频 vs 旧 192px 图集）」。
- **真实语音生命周期驱动**：待机时按住「按住说话」（或聚焦后按住空格/回车）进入 倾听（`listening`），松开后进入 思考（`thinking`）并提交转写/推理，**绝不通过定时器自动跳到说话**；首个有效音频分块出声时触发 `playing` 才进入 说话（`speaking`）；音频完整播放完毕（`completed`）后回到 待机（`idle`）；在思考或说话期间点击「停止本轮 / 停止回答」，立即进入 正在收尾（`stopping`）并锁死旧回调，等待 `device_released` 与全局空闲确认后安全放开入口回到待机。
- **真实语音服务接入台**：在预览台顶部可选择接入 `/device/desk-gge`、`/device/desk-cursor` 或 `/api`，支持文本直投测试问答流，实时展示轮次状态、播放队列与分块耗时。
- **静音与减动效**：所有角色视频均强制静音（实际产品声音来自 `<audio id="cn-voice-audio">` 真实播放器）；勾选/取消「播放动画」、系统开启 `prefers-reduced-motion` 或标签页隐藏时自动暂停视频循环并定格在清晰睁眼帧。
- **固定伙伴与设置**：点击圆屏顶部伙伴徽章（或离线时点击「查看连接」）打开圆屏内设置页，可调节演示音量与屏幕亮度；正式设备一机固定一位伙伴，多角色切换仅位于顶部开发预览栏。

## 逐角色素材校准与诚实边界

| 角色（开发预览） | 状态 | 采用素材与截取策略 | 校准参数 (`scale / tx / ty`) | 说明与诚实边界 |
| --- | --- | --- | --- | --- |
| **G哥 (`gpt`)** · 默认伙伴 | `idle` / `busy` / `stopping` / `offline` | `gpt/idle-blink-square-v1.mp4` (`4.65s–9.90s`) | `1.18 / +1.8% / +1.5%` | 使用已居中裁好的 `720×720` 正方形视频，截取睁眼与安静眨眼段（避开前段闭眼大笑），放大 `1.18×` 隐藏底部胸口横切线，完整保留龙角、尖耳与右侧发花 |
| **G哥 (`gpt`)** | `listening` / `peer` | `gpt/listening-nod.mp4` | `1.12 / -1.4% / +1.5%` | 专用闭嘴点头视频，微调水平位移与待机眼位对齐 |
| **G哥 (`gpt`)** | `thinking` | `gpt/thinking-question.mp4` | 默认无问号段 `1.12 / 0% / +1.5%`<br>含问号原片 `1.03 / +2.2% / +6.2%` | 默认截取 `0.0s–1.18s` 问号出现前的轻歪头凝思段（符合无文字/符号要求且保持大头比例）；开发栏可切到 `1.35s–3.15s` 含问号原片对比 |
| **G哥 (`gpt`)** | `speaking` | `gpt/idle-blink-square-v2.mp4` (`6.40s–9.40s`) | `1.18 / +1.8% / +1.5%` | **候选预览（未冒充定稿）**：G哥本批缺专用 `speaking.mp4`，当前截取 `square-v2` 后半段睁眼张闭嘴动作作候选，顶部横幅明确提示缺口 |
| **Claude (`claude`)** | `idle` / `listening` / `thinking` / `speaking` | `claude/idle.mp4`、`listening-nod.mp4`、`thinking-question.mp4`、`speaking.mp4` | `1.12 / 0~0.4% / +1.2%` | 5 段 `720×720` 动作齐全；放大 `1.12×` 消除原片内嵌灰框边线，完整保留橙黑贝雷帽与白花头饰 |
| **DeepSeek (`deepseek`)** | `idle` / `listening` / `thinking` / `speaking` | `deepseek/idle.mp4`、`listening-nod.mp4`、`thinking-question.mp4`、`speaking.mp4` | `1.09 / 0~0.4% / +1.5%` | 5 段动作齐全（含最新补充的 `thinking-question.mp4`）；默认截取 `0.0s–1.18s` 无问号凝思段，开发栏可切换对比右上角含问号原片 |

## 文件入口与构建检查

| 文件 | 用途 |
| --- | --- |
| [source.html](source.html) | 可编辑的原始 HTML/CSS/JS（包含单一推荐圆屏方案、双缓冲视频舞台、真实语音生命周期驱动、队列播放器与开发对照台） |
| [preview-shell.html](preview-shell.html) | 轻量独立 HTML5 预览外壳（无阻塞本地视频的沙箱限制，无外部依赖） |
| [build.py](build.py) | Python 标准库构建脚本，将 `source.html` 组装为 `index.html`，同时抽取 CSP 兼容的外链 `screen.css` 与 `screen.js`，支持 `--check` 校验 |
| [index.html](index.html) | 可直接打开或通过本地 HTTP 预览的生成结果，由 `build.py` 生成 |
| [screen.css](screen.css) / [screen.js](screen.js) | 由 `build.py` 生成的外链样式与脚本，供 `/device/{id}/screen` 同源严格 CSP 生产路由引用 |
| [preview.png](preview.png) | 默认双视口（466×466 + 1.35× 放大）的真实浏览器截图 |
| [test_device_ui_events.py](test_device_ui_events.py) | 自动化测试套件：校验构建一致性、无假计时器、CSP 零违规、真实语音事件驱动、停止失败重试合同、真实服务端屏幕路由集成以及失联超时/租约过期（lease-expired）放弃提示与恢复（严格依赖服务端原生路由，缺少原生路由明确失败） |
| [test-artifacts/](test-artifacts/) | 自动化测试生成的全部 8 种真实状态高保真截图证据（`idle / listening / thinking / speaking / stopping / error / busy / offline`） |
| [ASSET_BRIEF.md](ASSET_BRIEF.md) | 高清角色素材接入状态、缺口说明与生成提示词 |
| [UPSTREAM-NOTICE.md](UPSTREAM-NOTICE.md) | 固定素材版本的原始非官方同人声明 |

修改 `source.html` 或 `preview-shell.html` 后，在仓库根目录执行构建与全量测试：

```sh
python3 prototypes/device-ui/build.py
python3 prototypes/device-ui/build.py --check
PYTHONPATH=companion python3 prototypes/device-ui/test_device_ui_events.py
```

## 素材来源与合规声明

- 作者/来源：**fywdy / chatgpt-chibi-pets**；[固定版本](https://github.com/fywdy/chatgpt-chibi-pets/tree/d5bbb27c79e5c08e8b8ab44d4023cd35a67418e2)，提交 `d5bbb27c79e5c08e8b8ab44d4023cd35a67418e2`。
- 美术遵循 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（非商业使用、保留署名）。本目录中的视频为用户基于上述角色生成的衍生动画，保留原作者署名、非商用约束及 [UPSTREAM-NOTICE.md](UPSTREAM-NOTICE.md) 中的非官方同人声明，与 OpenAI / Anthropic / DeepSeek 无官方授权、赞助或背书关系。
- 15 段原始视频与 2 段 GPT 正方形居中裁切衍生视频（`idle-blink-square-v1/v2.mp4`）均完整保留，哈希与规格见 [assets/characters/manifest.json](assets/characters/manifest.json)。

## 本次验证与未验证边界（2026-10-18）

| 检查项 | 结果与证据范围 |
| --- | --- |
| `python3 prototypes/device-ui/build.py --check` | 通过；`index.html`、`screen.css`、`screen.js` 与 `source.html` + `preview-shell.html` 完全一致 |
| `PYTHONPATH=companion python3 prototypes/device-ui/test_device_ui_events.py` | 全量 20 项测试全部通过；在真实无头 Chrome 与真实 `create_device_app` HTTP 后端中验证：① 无假 1.5s 计时器；② `pointerdown` → `listening`；③ `pointerup` → `thinking` 且停留 2.2s 绝不自动跳转；④ 首块真实音频出声 `audio:playing` → `speaking`；⑤ `completed` → `idle`；⑥ 停止时锁死迟到音频回调并等待释放；⑦ 409 `busy`、合成/请求失败 `error`、服务掉线 `offline` / `online` 均由真实事件驱动；⑧ `/device/desk-gge/screen` 同源加载 0 CSP 违规；⑨ `/stop` 失败时不跳回 `idle`，保持 `stopping` 且主按键保持启用提示「再按停止」；⑩ 停止重试成功后进入收尾等待（主按键禁用提示「等待收尾完成」），直到后端 `device_released === true` 释放确认后才安全恢复 `idle`；⑪ 紧接着第二轮真实语音问答完整闭环 |
| 桌面 Chrome 真实渲染与尺寸校验 | 通过；主圆屏外径实测 `466×466 px`，放大视口实测 `629×629 px`，控制台 0 报错 |
| 视频加载、静音与区段寻址 | 通过；经内存 `Blob` 预取加载 `720×720` 视频，实测所有 `<video>` 的 `muted === true`、`defaultMuted === true`、`volume === 0`，各状态 `currentTime` 精准落入目标区段 |
| 停止防竞态与释放合同 | 通过；模拟「按住说话 (`listening`) → 松开 (`thinking`) → 点击停止 (`stopping`)」，等待超过 2.2 秒后仍保持收尾状态，未被旧 1.5 秒定时器切回 `speaking`，且对齐 PR #61 的 `device_released` 判定 |
| 多分辨率与 320px 窄屏检查 | 通过；在 `1440px`、`1024px`、`768px`、`320px` 视口下 `scrollWidth <= innerWidth`，无横向溢出或文字重叠 |

**尚未验证 / 诚实边界**：
- 未在 Waveshare ESP32-S3-Touch-AMOLED-1.75 实体硬件上测试视频解码帧率、内存占用、圆屏物理触控手感或功耗；
- G哥专用连续说话视频（当前用 `idle-blink-square-v2.mp4` 开口片段作候选）仍待后续按需补齐。
