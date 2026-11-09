# bothouse 自带桌宠（fork 自 dsh-pet）

本目录是 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT，版权 © 2026 PC2005-cloud）的 fork，
基线是上游 `main` 的 **c25386848f70f6e40902e4376f6e7b1e196bc326**（0.4.7，2026-11-09）。`LICENSE` 是上游原文，
上游版权声明保留不动；bothouse 的改动同样按 MIT 发布。上游仓库根目录的 API.md、CONFIG.md、FEATURES.md、openapi.yaml
放在 `docs/`。

## 跟上游的不同

窗口、透明、置顶、点穿、托盘、动画（`runtime/electron-helper`、`src/client`）照上游原样。只改了右键菜单里跟 AI 有关的几项，
以及它的状态来源。`bothouse pet run` 起桌宠时开一个本机接口（`bridge/cmd/cc-connect/pet_api.go`），
经环境变量 `BOTHOUSE_PET_API` / `BOTHOUSE_PET_TOKEN` / `BOTHOUSE_ADMIN_URL` 交给桌宠；没有这些变量时各处照上游运行。

| 菜单项 | 上游 | 现在 |
| --- | --- | --- |
| 打开 AI 设置 | 打开桌宠自己的 AI 设置页 | 打开 bothouse 管理页（`runtime/electron-helper/main/ipc.js`） |
| 查看余额 | 查桌宠配的模型服务商余额 | bothouse 的用量：今天、本月的回复次数、tokens、估算花费（`/api/v1/usage/roles`） |
| 待办事项 | 本地 todos.json | 团队任务板上没收口的活，只读（新增 `/api/v1/team/board`）；在桌宠里新建、勾掉会提示去任务板改 |
| 碎碎念 | 桌宠自己的模型现编一句 | 绑定角色这次启动后说过的话里随机一句 |
| 对话 | 桌宠自己的模型回 | 在绑定角色最近的会话里叫醒它跑一轮（同 `bothouse wake`），回话回到对话框；它也照常发在那个会话 |
| 配图 | 选一张图，模型配一句 | 选一张图，配上角色说过的一句 |
| 重载配置 | 重启桌面窗口，按最新配置重建 | 不变：纯桌宠本地维护，跟 bothouse 无关 |
| 睡觉、动作、显示位置、回到初始位置 | — | 不变 |

外形：桌宠穿绑定角色的衣服。`bothouse pet run` 的本机接口 `/skin` 回第一个绑定角色（按 key 排序，去掉 `bridge:`），宿主 `/thumb` 先查包内 `assets/roles/<角色>/`：同名动画优先，拖拽类用 `drag.webm`，其余都用 `idle.webm`（`src/host/routes/assets.ts` 的 `bothouseSkinFile`）。现带龙娘、橘、彩虹猫、grok 娘四套（工作台像素小人做的 640×360 VP9-alpha），鲸鱼娘就是上游原素材。在 bothouse 下素材回 `no-cache`，换绑定后下一个动作就换装。

待办只读：宿主 `GET /todos` 带 `readOnly: true`，面板藏掉添加框、勾选、删除和提醒提示。

状态：去掉了对 DSH 会话事件的订阅（删 `src/host/plugin/session-watch.ts`，`src/host/index.ts` 不再注册），
工作状态只由 bothouse 的角色事件驱动：`bothouse pet run` 读 `/api/v1/roles/events` 和插件页的角色绑定，经桌宠的
`/work-status`、`/broadcast` 推进来（`bridge/cmd/cc-connect/pet.go`）。

改动点都带「bothouse fork」注释：`grep -rn 'bothouse fork' src runtime`。新增文件：`src/host/bothouse.ts`、`assets/roles/`、
`scripts/bothouse-fetch-assets.mjs`、`bothouse-assets.json`、本文件。`package.json` 改了包名（bothouse-pet）、bin 名、
仓库地址，peerDependencies 全标可选（独立模式用 shims 替身，不装 DSH）。

## 素材

`assets/webm`（114 个动画，55MB）不进 bothouse 仓库。出包时 `node scripts/bothouse-fetch-assets.mjs` 按
`bothouse-assets.json` 从上游基线提交下载并校验 sha256。`assets/preview`（README 用的 GIF）不要。

## 出包和安装

发版时 release.yml 的 `desktop-pet` 作业：`pnpm install` → 下素材 → `tsdown` → `build-desktop-core`（生成 `runtime/electron-helper/shared-core.js`，不进 git，漏了桌宠窗口是空的） → `npm pack`，把
`bothouse-pet.tgz` 挂到发布页。`bothouse pet start` 用 npm 装本版本的这个包（开发版装最新发布的）；
本地调试设 `BOTHOUSE_PET_DIR=<本目录>`（先 `npx pnpm@10 install && node scripts/bothouse-fetch-assets.mjs && npx tsdown && node scripts/build-desktop-core.mjs`）。

## 跟上游拿更新

1. `git clone https://github.com/PC2005-cloud/dsh-pet /tmp/dsh-pet`，看基线之后的提交：
   `git -C /tmp/dsh-pet log --oneline c25386848f70f6e40902e4376f6e7b1e196bc326..main -- dsh-pet`。
2. 出补丁打到本目录：`git -C /tmp/dsh-pet diff c25386848f70..main -- dsh-pet | git apply -p2 --directory=plugins/desktop-pet --3way`
   （在 bothouse 仓库根目录跑）。冲突只会出在带「bothouse fork」注释的地方，保留我们的改动。
3. 上游改了 `assets/webm`：重算 `bothouse-assets.json`（新提交号 + 各文件 sha256）。
4. 把本文件和 `bothouse-assets.json` 里的基线提交号改成新的。
