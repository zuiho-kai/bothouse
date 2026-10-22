import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { color, PALETTE } from '../packages/client-ui-discord/src/client/theme.ts'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const cssPath = join(rootDir, 'packages/client-ui-discord/src/client/ChannelsPage.module.css')
const outDir = join(rootDir, 'docs/screenshots')
mkdirSync(outDir, { recursive: true })

const rawCss = readFileSync(cssPath, 'utf-8')

const themeVariables = `
  :root {
    --dsw-alias-label-primary: #1e1f24;
    --dsw-alias-label-secondary: #4b4f58;
    --dsw-alias-label-tertiary: #747883;
    --dsw-alias-label-primary-inverted: #ffffff;
    --dsw-alias-label-primary-foreground: #ffffff;
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer-2: #f2f3f5;
    --dsw-alias-border-l2: #e3e5e8;
    --dsw-alias-interactive-bg-hover: #ebedef;
    --dsw-alias-interactive-bg-active: #e3e5e8;
    --dsw-alias-state-business-primary: #5865f2;
    --dsw-alias-state-success-primary: #23a55a;
    --dsw-alias-state-warn-primary: #f0b232;
    --dsw-alias-state-error-primary: #f23f43;
    --dsw-alias-state-idle-primary: #80848e;
    --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.48);
    --dsw-radius-xs: 3px;
    --dsw-radius-sm: 4px;
    --dsw-radius-md: 8px;
    --dsw-radius-lg: 12px;
    --dsw-elevation-panel: 0 12px 32px rgba(0, 0, 0, 0.15);
  }

  body[data-ds-dark-theme="dark"] {
    --dsw-alias-label-primary: #dbdee1;
    --dsw-alias-label-secondary: #949ba4;
    --dsw-alias-label-tertiary: #80848e;
    --dsw-alias-label-primary-inverted: #353638;
    --dsw-alias-label-primary-foreground: #ffffff;
    --dsw-alias-bg-base: #313338;
    --dsw-alias-bg-layer-2: #2b2d31;
    --dsw-alias-border-l2: #3f4147;
    --dsw-alias-interactive-bg-hover: #35373c;
    --dsw-alias-interactive-bg-active: #3c3e44;
    --dsw-alias-state-business-primary: #5865f2;
    --dsw-alias-state-success-primary: #23a55a;
    --dsw-alias-state-warn-primary: #f0b232;
    --dsw-alias-state-error-primary: #f23f43;
    --dsw-alias-state-idle-primary: #80848e;
    --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.5);
    --dsw-radius-xs: 3px;
    --dsw-radius-sm: 4px;
    --dsw-radius-md: 8px;
    --dsw-radius-lg: 12px;
    --dsw-elevation-panel: 0 12px 32px rgba(0, 0, 0, 0.4);
  }

  @media (prefers-color-scheme: dark) {
    body[data-ds-dark-theme="system"] {
      --dsw-alias-label-primary: #dbdee1;
      --dsw-alias-label-secondary: #949ba4;
      --dsw-alias-label-tertiary: #80848e;
      --dsw-alias-label-primary-inverted: #353638;
      --dsw-alias-label-primary-foreground: #ffffff;
      --dsw-alias-bg-base: #313338;
      --dsw-alias-bg-layer-2: #2b2d31;
      --dsw-alias-border-l2: #3f4147;
      --dsw-alias-interactive-bg-hover: #35373c;
      --dsw-alias-interactive-bg-active: #3c3e44;
      --dsw-alias-state-business-primary: #5865f2;
      --dsw-alias-state-success-primary: #23a55a;
      --dsw-alias-state-warn-primary: #f0b232;
      --dsw-alias-state-error-primary: #f23f43;
      --dsw-alias-state-idle-primary: #80848e;
      --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.5);
      --dsw-elevation-panel: 0 12px 32px rgba(0, 0, 0, 0.4);
    }
  }
`

function buildHtml(mode) {
  const cZxy = color('zxy')
  const cCjiang = color('cjiang')
  const cGge = color('gge')
  const cDadoubao = color('dadoubao')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSH Discord 频道 - 主题预览 (${mode})</title>
<style>
${themeVariables}
${rawCss}
html, body {
  margin: 0;
  padding: 0;
  height: 100vh;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
</style>
</head>
<body data-ds-dark-theme="${mode}">
<div class="page">
  <aside class="rooms">
    <div class="groupTitle">频道列表</div>
    <div class="room roomActive"><span class="hash">#</span> general</div>
    <div class="room"><span class="hash">#</span> 开发讨论</div>
    <div class="room"><span class="hash">#</span> 任务看板</div>
  </aside>

  <main class="chat">
    <header class="chatHead"><span class="hash">#</span> general</header>
    <div class="log">
      <!-- 消息 1 -->
      <div class="message">
        <span class="avatar" style="background: ${cZxy};">Z</span>
        <div class="messageBody">
          <div class="messageHead">
            <span class="author">zxy</span>
            <span class="time">13:45</span>
          </div>
          <div class="text">大家看一下 #5 主题收口进展，所有颜色现在都统一走 --dsw-alias-* 了。</div>
        </div>
      </div>

      <!-- 消息 2 -->
      <div class="message">
        <span class="avatar" style="background: ${cCjiang};">C</span>
        <div class="messageBody">
          <div class="messageHead">
            <span class="author">C酱</span>
            <span class="tag">AI</span>
            <span class="time">13:46</span>
          </div>
          <div class="text">收到！硬编码 #fff 和 #23a55a 全部替换为主题语义变量，头像色板已对齐。</div>
          <div class="card">
            <div class="cardTitle">PR #5 主题收口（只用 DSH 主题变量）</div>
            <div style="font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 4px;">vitest 全量通过，CSS 零十六进制颜色。</div>
          </div>
        </div>
      </div>

      <!-- 消息 3 -->
      <div class="message">
        <span class="avatar" style="background: ${cDadoubao};">大</span>
        <div class="messageBody">
          <div class="messageHead">
            <span class="author">大豆包</span>
            <span class="tag">DSH</span>
            <span class="time">13:47</span>
          </div>
          <div class="text">前端三套主题（浅色、深色、跟随系统）视觉验收正常，按钮和在线点完美匹配！</div>
        </div>
      </div>

      <div class="working">
        <span class="author">G哥</span> 正在处理…
      </div>
    </div>

    <div class="composer">
      <div class="composerRow">
        <textarea class="input" rows="1" placeholder="发消息到 #general，@成员 让它干活（Enter 发送，Shift+Enter 换行）"></textarea>
      </div>
    </div>
  </main>

  <aside class="members">
    <div class="groupTitle">在线成员 — 4</div>
    <div class="member">
      <div class="memberAvatar">
        <span class="avatar avatarSmall" style="background: ${cZxy};">Z</span>
        <span class="presence"></span>
      </div>
      <div class="memberText">
        <span class="memberName">zxy</span>
        <span class="memberStatus">在线</span>
      </div>
    </div>
    <div class="member">
      <div class="memberAvatar">
        <span class="avatar avatarSmall" style="background: ${cCjiang};">C</span>
        <span class="presence"></span>
      </div>
      <div class="memberText">
        <span class="memberName">C酱</span>
        <span class="memberStatus">在线 · Claude 3.7</span>
      </div>
    </div>
    <div class="member">
      <div class="memberAvatar">
        <span class="avatar avatarSmall" style="background: ${cGge};">G</span>
        <span class="presence"></span>
      </div>
      <div class="memberText">
        <span class="memberName">G哥</span>
        <span class="memberStatus">工作中…</span>
      </div>
    </div>
    <div class="member">
      <div class="memberAvatar">
        <span class="avatar avatarSmall" style="background: ${cDadoubao};">大</span>
        <span class="presence"></span>
      </div>
      <div class="memberText">
        <span class="memberName">大豆包</span>
        <span class="memberStatus">在线 · 前端主力</span>
      </div>
    </div>
  </aside>
</div>
</body>
</html>`
}

function buildMobileHtml(drawer = 'rooms') {
  const cZxy = color('zxy')
  const cCjiang = color('cjiang')
  const cDadoubao = color('dadoubao')
  const cGge = color('gge')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Discord 频道 - 移动端抽屉预览 (${drawer})</title>
<style>
${themeVariables}
${rawCss}
html, body {
  margin: 0;
  padding: 0;
  height: 100vh;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
</style>
</head>
<body data-ds-dark-theme="dark">
<div class="page">
  <nav class="rooms ${drawer === 'rooms' ? 'drawerOpen' : ''}">
    <div class="groupHead">
      <h3 class="groupTitle">频道</h3>
      <div class="roomsHeadActions">
        <button type="button" class="iconButton" title="新建频道">+</button>
        <button type="button" class="drawerCloseButton" title="关闭侧栏" aria-label="关闭侧栏">✕</button>
      </div>
    </div>
    <div class="room roomActive"><span class="hash">#</span> general</div>
    <div class="room"><span class="hash">#</span> 开发讨论</div>
    <div class="room"><span class="hash">#</span> 任务看板</div>
  </nav>

  <main class="chat">
    <header class="chatHead">
      <button type="button" class="mobileNavButton" aria-label="切换频道列表" title="切换频道列表">☰</button>
      <span class="chatTitle"><span class="hash">#</span> general</span>
      <button type="button" class="mobileNavButton" aria-label="切换成员列表" title="切换成员列表">👥</button>
    </header>
    <div class="log">
      <div class="message">
        <span class="avatar avatarSmall" style="background: ${cDadoubao};">大</span>
        <div class="messageBody">
          <div class="messageHead">
            <span class="author">大豆包</span>
            <span class="tag">DSH</span>
            <span class="time">10:00</span>
          </div>
          <div class="text">移动端抽屉（375×667 触控 ≥44px）实测效果。</div>
        </div>
      </div>
    </div>
    <div class="composer">
      <div class="composerRow">
        <textarea class="input" rows="1" placeholder="发送到 #general"></textarea>
        <button type="button" class="mentionButton">@</button>
      </div>
    </div>
  </main>

  <aside class="members ${drawer === 'members' ? 'drawerOpen' : ''}">
    <div class="memberPanelHead">
      <button type="button" class="addMemberButton">+ 添加成员</button>
      <button type="button" class="drawerCloseButton" title="关闭侧栏" aria-label="关闭侧栏">✕</button>
    </div>
    <div class="groupTitle">成员 — 2</div>
    <div class="memberRow">
      <div class="member">
        <div class="memberAvatar">
          <span class="avatar avatarSmall" style="background: ${cGge};">G</span>
          <span class="presence"></span>
        </div>
        <div class="memberText">
          <span class="memberName">G哥</span>
          <span class="memberStatus">工作中…</span>
        </div>
      </div>
    </div>
    <div class="memberRow">
      <div class="member">
        <div class="memberAvatar">
          <span class="avatar avatarSmall" style="background: ${cDadoubao};">大</span>
          <span class="presence"></span>
        </div>
        <div class="memberText">
          <span class="memberName">大豆包</span>
          <span class="memberStatus">在线 · 前端主力</span>
        </div>
      </div>
    </div>
  </aside>

  <div class="mobileBackdrop"></div>
</div>
</body>
</html>`
}

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

for (const mode of ['light', 'dark', 'system']) {
  const html = buildHtml(mode)
  const tempHtmlPath = join(outDir, `preview-${mode}.html`)
  const outPngPath = join(outDir, `theme-${mode}.png`)
  writeFileSync(tempHtmlPath, html, 'utf-8')

  console.log(`Generating screenshot for ${mode} theme...`)
  execFileSync(chromePath, [
    '--headless',
    '--disable-gpu',
    `--screenshot=${outPngPath}`,
    '--window-size=1280,800',
    `file://${tempHtmlPath}`,
  ])
  console.log(`Saved: ${outPngPath}`)
}

for (const drawer of ['rooms', 'members']) {
  const html = buildMobileHtml(drawer)
  const tempHtmlPath = join(outDir, `preview-mobile-${drawer}.html`)
  const outPngPath = join(outDir, `mobile-drawer-${drawer}.png`)
  writeFileSync(tempHtmlPath, html, 'utf-8')

  console.log(`Generating screenshot for mobile drawer: ${drawer}...`)
  execFileSync(chromePath, [
    '--headless',
    '--disable-gpu',
    `--screenshot=${outPngPath}`,
    '--window-size=375,667',
    `file://${tempHtmlPath}`,
  ])
  console.log(`Saved: ${outPngPath}`)
}

console.log('All screenshots taken successfully!')
