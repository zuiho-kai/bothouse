# bothouse for JiuwenSwarm

给 JiuwenSwarm 里的成员带上 BotHouse 的人设和记忆 wiki：装上以后，每次对话发给模型的系统提示词里都有这两段，不用再配置。

## 安装

先装好 JiuwenSwarm（`pip install workswarm`，`jiuwenswarm-start` 在 PATH 里），然后一条命令：

~~~sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/jiuwenswarm/plugin-pkg/install.sh | sh
~~~

装完重启 JiuwenSwarm（`jiuwenswarm-start`）。JiuwenSwarm 升级后重跑这条命令；重复跑没有副作用。

## 它做了什么

1. 把扩展放进 JiuwenSwarm 数据目录的 `application_plugins/bothouse/`，JiuwenSwarm 启动时自己会加载。
2. 给装好的 JiuwenSwarm 打一个补丁（一个文件、加一节系统提示词），并让它的后台 Worker 退出，下次启动读到补丁。
3. 准备人设和记忆：
   - 本机 BotHouse 里有跑 JiuwenSwarm 的角色（命令是 `jiuwenswarm-acp`）时，用那个角色的人设文件，里面已经带着它的记忆 wiki 段；
   - 没有时建一个默认角色「橘」：人设在 `<JiuwenSwarm 数据目录>/bothouse/roles/jiuwenswarm/AGENTS.md`，可以直接改；记忆 wiki 在同目录的 `wiki/`，和 BotHouse 给角色建的一样（要有 `git`）。以后在 BotHouse 里加了 JiuwenSwarm 角色，自动改用那个角色的。

## 补丁对准的版本

补丁对准 PyPI 上的 workswarm **0.2.8**（清单在 `patches/manifest.json`）。装命令先核对版本号和目标文件的 sha256，两样都对才打，打完再核一遍结果；重复跑会说「补丁之前打过」。

对不上时（别的版本、文件被改过）装命令不动 JiuwenSwarm 的文件，打印一行：

~~~
补丁跳过：装的是 workswarm 0.2.9，补丁只对准 0.2.8。JiuwenSwarm 的文件没有动；人设和记忆改为拼在每条消息前面（聊天里看得到）。
~~~

这时人设和记忆仍然会带上，只是拼在你发的每条消息前面，聊天记录里看得到。等这里补上新版本的补丁后，重跑装命令即可。

## 开发

~~~sh
PATH=<装了 workswarm 的 venv>/bin:$PATH sh jiuwenswarm/plugin-pkg/install.sh   # 在仓库里直接跑，用本地文件
~~~

- `files.txt`：用 curl 安装时要下载的全部文件（含 `bridge/contrib/wiki` 里建 wiki 用的程序和模板），加文件要同步这里。
- 加一个 workswarm 版本：在 `patches/workswarm-<版本>/` 放补丁（LF 换行），在 `patches/manifest.json` 记原文件和打完后的 sha256，路径加进 `files.txt`。
