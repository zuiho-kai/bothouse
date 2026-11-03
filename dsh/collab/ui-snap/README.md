# UI 截图回归（Issue #98 U7）

只新增测试，不改页面。把 `page.html` 和 `desk/index.html` 放进临时 HTTP 宿主，用固定成员/消息/忙闲状态渲染，桌面 1440×900 与手机 390×844 × 亮/暗各截一张，和 `baseline/` 比像素差，并检查横向溢出与文字被裁切。

## 跑

```sh
# 需要 puppeteer-core 与本机 Chrome
PUPPETEER_MODULE=/abs/path/node_modules/puppeteer-core \
  node --test dsh/collab/ui-snap.test.mjs

# 首次或有意改版后更新基准（会写 baseline/*.png 与 manifest.json）
PUPPETEER_MODULE=/abs/path/node_modules/puppeteer-core \
  node dsh/collab/ui-snap/run.mjs --update
```

没装 `puppeteer-core` 或找不到 Chrome 时，测试整条 `skip`，不伪装成通过。`PUPPETEER_MODULE` 指向包目录（含 `package.json`），`CHROME_PATH` 可覆盖浏览器路径。

## 判定

- 像素差阈值：单通道差 `> 16/255` 记为变化；变化像素占比 `> 0.1%` 报红。来源：U7 派活要求「像素差超阈值报红」；本机 Chromium 连续三次截图实测逐像素差 0，留抗锯齿/字体栅格化余量。
- 先比尺寸；尺寸不同直接报红。超阈值时把红色差异图写到临时产物目录。
- 横向溢出：`documentElement.scrollWidth` 超过视口，或可见元素右缘越过视口。
- 文字裁切：文本节点被 `overflow: hidden/clip` 祖先切掉；显式 `text-overflow: ellipsis` / 行截断不算。
- 截图前固定时间到 `2026-11-03T14:40:00+08:00`、关闭动画与过渡、等字体和头像加载，避免时钟/动效漂移。

## 基准

`baseline/` 是 8 张 PNG 与 `manifest.json`（平台、浏览器版本、固定时间、视口、阈值）。`manifest.json` 的平台与当前不一致时仍会比较，但跨平台字体差异可能超阈值；跨平台跑请先在本机 `--update` 后使用，或只把 CI 当跳过项。

## 产物

正常跑把实际截图与 diff 图放临时目录，路径打在测试诊断/CLI 末尾；不写进仓库。
