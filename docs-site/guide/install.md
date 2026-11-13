# 开始前：装 bothouse

::: tip 看到不懂的词
先查[名词对照](../glossary)。还没有 AI 工具的，先看[还没有 AI 工具？](./choose#no-ai)。
:::

三条路线都从这一页开始。做完这页，你的浏览器里会打开 bothouse 的**安装页面**。

## 1. 下载安装

任选一种。

**新手推荐：下载安装包，双击打开**

去 [下载页](https://github.com/zuiho-kai/bothouse/releases/latest) 下载：

- Mac：`bothouse-mac.dmg`，打开后把 Bothouse 拖进「应用程序」。第一次打开要**右键 → 打开**（安装包没有签名，直接双击会被拦）。
- Windows：`bothouse-windows.exe`，双击运行。被 SmartScreen 拦住就点「更多信息 → 仍要运行」。

**或者用一行命令装**（本教程实测用的是这种）

先打开终端：Mac 按 `Command + 空格`，输入「终端」回车；Windows 开始菜单搜「PowerShell」打开（不用管理员）。

Mac 或 Linux，复制下面这行，粘贴进终端，回车：

```sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
```

Windows，复制下面这行，粘贴进 PowerShell，回车：

```powershell
irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex
```

你会看到：最后一行是 `Installed: …/bothouse (v0.1.xx)`。

::: details 没装上？
- **国内网络下载很慢或失败**：安装包放在 GitHub 上，国内经常连不上。要用能打开 GitHub 的网络（比如开着你平时「翻墙」用的软件）再下载。
- **提示 `typing 'bothouse' runs another copy first`**：你电脑上还有一个旧的 bothouse。照它打出的那行命令把新的路径放到前面，或者直接用它打出的完整路径运行。
:::

## 2. 打开安装页面

用安装包装的：直接打开 Bothouse 应用。

用命令装的：在终端里敲下面这个词，回车。

```sh
bothouse
```

提示「找不到命令」（command not found）？把终端窗口关掉，重新打开一个再敲。

你会看到：浏览器自动打开一个页面，最上面写着「从这里，成为一支队伍」，下面让你选「你想在哪儿用？」。

![安装页面第一页：你想在哪儿用](/img/wizard-platform.png)

::: details 浏览器没自动打开？
终端里会打出一条 `http://localhost:…/login?token=…` 的链接，复制到浏览器打开。这条链接带着登录口令，**别发给别人**。
:::

## 3. 选你的路线

在这一页点你要走的那一个，然后去对应的教程：

- 点 **DSH** → [路线 A：DSH 桌面版](./dsh)
- 点 **Discord** → [路线 B：Discord](./discord)
- 点 **QQ** → [路线 C：QQ](./qq)（施工中）

卡片里还有一个「飞书 / Lark」，暂时没有新手教程。

::: tip 卡片上的小字看不懂？
卡片上写的「一主多 sub、gate」这些是内部叫法，不用管。意思是「可以有一个队长带几个队员」。所有叫法的对照见[名词对照](../glossary)。
:::
