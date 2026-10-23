# 安装向导的两种风格（Issue #52）

首次打开安装向导时使用明亮风格；右上角可直接在明亮与深色之间切换。选择沿用 `cc_theme` 保存，刷新后保留，已有 light/dark/system 偏好继续生效。普通管理页的默认风格仍为深色。向导隐藏管理侧栏，保留语言、手动配置入口与原安装步骤。

## 样式来源

- wiki `~/wiki/projects/software/household/biz/ecosystem/bothouse/role-household-oss-promo.md:33`：轻快、面向中国二次元；转白色讲「AI 的家」，封面白或白黄。
- 同页第 **34 行**：用户要求「从我们那边开始都要有白底明亮的背景」。这是明亮底色的方向依据。
- `~/wiki/projects/software/household/system/system/role-household-interface.md:29` 讲角色头像画风；没有定义安装向导的色值、字体或圆角。三条 wiki 搜索（配色、角色小家 页面、主题）也没有给出数值化设计规范。
- README 首页引用 `docs/assets/demo-chat.zh.png` / `demo-chat.en.png`。从中文 PNG 像素核对的现有强调色为蓝紫 **#5865f2**、绿 **#3ba55d**、橙 **#e67e22**、粉 **#eb459e**。明亮向导主色直接使用 #5865f2，辅助色使用对应的柔和浅色；白底加极淡蓝紫/暖黄渐变。具体色值出自仓库图片，不能归称为 wiki 的原文。
- 字体沿用 `bridge/web/src/index.css` 的系统无衬线栈（-apple-system、BlinkMacSystemFont、Segoe UI、Inter、sans-serif），不下载外部字体。沿用现有圆角卡片的语言，主卡 24px、选项卡 16px。
- 深色沿用 `index.css` 的荧光绿（66 255 156）和 Layout/Card 的黑色背景、半透明边框。

## 验证

在 `bridge/web` 执行 `pnpm lint`、`pnpm test`、`pnpm build`。原仓库没有 lint/test 命令，本次补齐 ESLint 与 Vitest。lint 覆盖全部 src 的基础 TypeScript 规则与 Hooks 调用规则；Hooks 依赖检查先覆盖向导和本次修改的布局组件，其他页面已有的依赖告警不纳入本次迁移。

7 项主题偏好测试覆盖首次默认值、首次登录链接、两种保存的选择、已有系统偏好、无效存储和管理页默认值。将 theme.ts 暂时还原为原提交后，首次向导、首次登录和无效存储 3 项失败；恢复实现后 7 项通过。

构建含前端的 bothouse，在 `HOME=/tmp/themetest`（独立配置、动态 localhost 端口、无机器人）启动。以 headless Chromium 打开真实登录链接，用 `.github/ui-preview/wizard.mjs` 验证首次明亮、键盘切换、刷新记忆、平台卡片、表单保留、未校验不能继续和 390px 手机无横向溢出；两种风格均无未捕获前端异常。

桌面截图 `/tmp/theme/shot-new.png`、`/tmp/theme/shot-dark.png`；另有手机截图 `shot-mobile-light.png`、`shot-mobile-dark.png` 和 `wizard-smoke.json`。CI 的 UI preview 也纳入 Setup 的两种风格截图与前端 lint/test。

Go 全量第一次因 `core/agent_hooks_test.go` 的 `os.DirFS("..")` 遍历本地 pnpm node_modules 符号链接失败。将该依赖目录临时移出 bridge 后，`go test -tags no_web -p 1 -count=1 ./...` 全量通过（49 个包），随后已恢复依赖目录。日志在本地 `/tmp/theme/go-test.log`。Go 源码未改。

这是单一 Agent 的实现与自查；未部署、未合并、未连接真实平台或模型。
