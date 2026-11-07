# 在 DSH 里用 bothouse（实验）

把 bothouse 的插件装进 DeepSeek 的 DSH，角色住在 DSH 的频道里，@ 谁谁回。可以添加多个 DeepSeek 或 CLI 成员。

DSH 有两种用法，向导第一步让你选：

- **DSH 桌面版（推荐，默认）**：角色住在 DeepSeek Harness 桌面应用里，不用开浏览器。
- **DSH 网页版**：角色住在浏览器标签页里，要自己装 `dsh` 命令和 Node。

## 要准备

只有选 DSH 才需要这些。

选桌面版：

- **DeepSeek Harness 桌面版**：从官方下载安装（Apple 芯片 Mac：[dmg](https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg)，Intel Mac：[dmg](https://download.deepseek.com/desktop/dsh-latest-macos-x64.dmg)，Windows：[exe](https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe)）。向导里没找到桌面版时也会给出这个下载链接。
- 不用另装 Node、pnpm 或 `dsh` 命令：向导用桌面版里自带的那份。

选网页版：

- **Node.js 22.12 或更新**：终端里运行 `node -v` 看版本；没有或太旧就到 [nodejs.org](https://nodejs.org/) 下载 LTS 版安装（自带 npm）。
- **DSH 本体**（`0.2.1-rc.2` 或更新）：终端里运行

  ```sh
  npm i -g @deepseek-ai/dsh@latest
  ```

  装好后 `dsh --version` 能打出版本号就行（国内网络慢可加 `--registry=https://registry.npmmirror.com`）。要写 `@latest`：DSH 目前只发预发布版，有的 npm 版本不写会报「No matching version found」。
  npm 装的时候打出一串 `allow-scripts` 的提示，不用管，不影响使用。
- 不用另装 pnpm，向导缺了会自己补上。

两种都要：

- **一个回话用的模型**，二选一：一把 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com/) 的 API Keys 页创建），或者本机一个已经登录过的 CLI（Codex、Claude Code……，先在终端里登录好）。

## 1. 装 bothouse

见[首页第 1 步](../GETTING_STARTED.md#1-装)。

## 2. 走向导

运行 `bothouse`，浏览器会打开安装向导。第一页「你想在哪儿用」选 **DSH**，然后四步：

1. **选择 DSH**：选「DSH 桌面版（推荐）」或「DSH 网页版」。提示没找到，就照上面「要准备」装好，再点「重新检测」；也可以改选另一种。
2. **安装插件**：点「安装插件」，向导把 bothouse 的频道插件装进 DSH，第一次要等一两分钟。选桌面版时，如果桌面版从没打开过，向导会先自动打开它一次。
3. **角色和模型**：给每个角色选「用什么回话」：本机已登录的 CLI，或 DeepSeek 模型（要填 API Key）。刚在终端登录的 CLI，回到这一步（点「上一步」再进来）就会重新检测。
4. **打开 DSH**：
   - 桌面版：点「在桌面版里打开」。桌面版已经开着时，向导会先让它退出再打开，这样才能加载频道和角色，不用你手动重启。在左侧栏点「频道」，进 #general，角色已经在成员列表里。
   - 网页版：点「打开 DSH」，新标签页打开 DSH 的 #general 频道，角色已经在成员列表里。第一次打开有一页「预览版说明」，点「继续」。
   - 选了桌面版也可以点下面的「打开网页版」改在浏览器里用。

在输入框里 `@角色名` 说一句话，角色就会回。

## 以后怎么再打开 DSH

- 桌面版：像平常一样从程序坞、启动台或开始菜单打开 DeepSeek Harness，在左侧栏点「频道」。
- 网页版：终端运行 `bothouse web` 打开管理面板，在「概览」页点「打开 DSH」（装了桌面版时是「在桌面版打开」和「网页版」两个按钮）。DSH 网页没在运行时（比如重启过电脑），这个按钮会先把它启动起来再打开，第一次启动可能要等一两分钟。
- 直接打开频道页地址时如果看到「频道页（DSH）没有在运行」，也照上面在面板里点「打开 DSH」。

## 手动装插件后重启桌面版

不走向导（比如用下面的命令装）时，装完要把桌面版完全退出再重新打开（Mac 上按 ⌘Q，只关窗口不算退出），侧栏才会出现频道。桌面版窗口里的频道在桌面版的 Plugins 页开关。

## 不用浏览器

先运行 `bothouse module add dsh --dry-run` 检查，再运行 `bothouse module add dsh --lang zh` 安装。两条命令输出 JSON；预演不会安装或写配置，已装过时正式添加会恢复启用。也可以直接从 GitHub 装插件：

```sh
dsh plugin --profile web add 'github:zuiho-kai/bothouse#dsh-plugin&path:dsh/plugin-pkg'
```

不走向导装插件时，频道里会自动放一个默认角色（鲸鱼娘），用 DSH 默认的 DeepSeek 模型回话。DSH 里还没填 DeepSeek API Key 时，第一句话会出一张「还没填模型密钥」的卡片：点卡片上的「去填密钥」填好 Key，或在成员设置里给它换一个能用的模型，再点「重试」。走向导不会遇到这张卡：向导里选 DeepSeek 模型的角色必须先填 Key 才能保存。

在 DSH 里添加多个成员：[同模型多成员指南](../single-cli-team.md#在-dsh-里创建三个成员)。

## 以后

- 再加 QQ、Discord、飞书：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- `bothouse module list` 显示 DSH 未配置、已启用或已停用。
- `bothouse module disable dsh` 停用，`bothouse module add dsh` 恢复启用；结果为 JSON。
- 插件位于 DSH 的 `web` profile；机器上装过 DeepSeek Harness 桌面版时，安装器也装进桌面版的 `desktop` profile（桌面版只允许它自带的 CLI 改这个 profile，安装器会自动找 `/Applications/DeepSeek Harness.app/...`、`~/Applications/...` 或 `%LOCALAPPDATA%\Programs\DeepSeek Harness\...`，别的位置用 `DSH_DESKTOP_BIN` 指过去）。桌面版装完要重启才加载插件。
- 只装了 DeepSeek Harness 桌面版、`PATH` 里没有 `dsh` 的 Mac 不用另装命令行：检测、`module add dsh`、`setup hooks --cli dsh` 和面板里给出的打开命令都用桌面版 app 包内自带的那份 CLI（`/Applications/DeepSeek Harness.app/...` 或 `~/Applications/...`，别的位置用 `DSH_DESKTOP_BIN` 指过去）。机器上另有 `dsh` 命令时仍然优先用它。
- 停用使用 DSH 原生的 `disabled` 标记，保留依赖、角色和历史。改动后重启该 DSH profile 生效，命令不会替你重启服务。`bothouse module disable dsh` 只改 `web` profile；桌面版窗口里的频道在桌面版的 Plugins 页开关。
- 改动前备份原 `cordis.patch.yml` 为旁边的 `.bak-时间戳` 文件；需要回退时恢复备份。其他自定义配置保留；已有动态 `disabled: !!js ...` 表达式时拒绝覆盖，提示在 DSH 中处理。

状态按已注册插件包、web profile、DSH HOME 全局 patch 的顺序计算。全局 patch 优先于 profile；若全局策略与要切换的状态冲突，命令会报错且不写文件，请先在 DSH 中调整全局策略。命令不会为了单个平台改写影响其他 profile 的全局设置。
