# bothouse for JiuwenSwarm

给 JiuwenSwarm 里的成员带上 BotHouse 的人设和记忆 wiki：装上以后，每次对话发给模型的系统提示词里都有这两段，不用再配置。

## 安装

先装好 JiuwenSwarm（`pip install workswarm`，`jiuwenswarm-start` 在 PATH 里），然后一条命令：

~~~sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/jiuwenswarm/plugin-pkg/install.sh | sh
~~~

装完重启 JiuwenSwarm（`jiuwenswarm-start`）。JiuwenSwarm 升级后重跑这条命令；重复跑没有副作用。

## JiuwenSwarm 0.2.9 及以后：插件包

0.2.9 去掉了下面第 1 步用的 `application_plugins` 加载，改成「插件包」。装命令看到这种版本时只做两件事，不改 JiuwenSwarm 的任何文件：

1. 用 JiuwenSwarm 自己的导入、安装插件接口装插件包 `plugin/bothouse/`（插件中心「我的插件」里叫「bothouse 人设与记忆」）。它的 Rail 每次调用模型前把人设和记忆 wiki 段放进系统提示词。
2. 准备人设和记忆，和下面第 3 步一样。

用法：网页对话里勾选这个插件；飞书、钉钉等渠道的 AI 同事（JiuwenMate）在同事的「能力 → 插件」里勾上它，再发布。网页和飞书用的是同一个同事、同一份发布版本。

## 0.2.8：它做了什么

1. 把扩展放进 JiuwenSwarm 数据目录的 `application_plugins/bothouse/`，JiuwenSwarm 启动时自己会加载。
2. 给装好的 JiuwenSwarm 打一个补丁（一个文件、加一节系统提示词），并让它的后台 Worker 退出，下次启动读到补丁。
3. 准备人设和记忆：
   - 本机 BotHouse 里有跑 JiuwenSwarm 的角色（命令是 `jiuwenswarm-acp`）时，用那个角色的人设文件，里面已经带着它的记忆 wiki 段；
   - 没有时建一个默认角色「橘」：人设在 `<JiuwenSwarm 数据目录>/bothouse/roles/jiuwenswarm/AGENTS.md`，可以直接改；记忆 wiki 在同目录的 `wiki/`，和 BotHouse 给角色建的一样（要有 `git`）。以后在 BotHouse 里加了 JiuwenSwarm 角色，自动改用那个角色的。

## 补丁对准的版本

补丁对准 PyPI 上的 workswarm **0.2.8**（补丁和清单在仓库根目录的 `patches/jiuwenswarm/`，清单是 `manifest.json`）。装命令先核对版本号和目标文件的 sha256，两样都对才打，打完再核一遍结果；重复跑会说「补丁之前打过」。

对不上时（别的版本、文件被改过）装命令不动 JiuwenSwarm 的文件，打印一行：

~~~
补丁跳过：装的是 workswarm 0.2.7，补丁只对准 0.2.8。JiuwenSwarm 的文件没有动；人设和记忆改为拼在每条消息前面（聊天里看得到）。
~~~

这时人设和记忆仍然会带上，只是拼在你发的每条消息前面，聊天记录里看得到。等这里补上新版本的补丁后，重跑装命令即可。

## 开发

~~~sh
PATH=<装了 workswarm 的 venv>/bin:$PATH sh jiuwenswarm/plugin-pkg/install.sh   # 在仓库里直接跑，用本地文件
~~~

- `files.txt`：用 curl 安装时要下载的全部文件（含 `bridge/contrib/wiki` 里建 wiki 用的程序和模板），加文件要同步这里。
- 加一个 workswarm 版本：在仓库根目录的 `patches/jiuwenswarm/workswarm-<版本>/` 放补丁（LF 换行），在 `patches/jiuwenswarm/manifest.json` 记原文件和打完后的 sha256，路径加进 `files.txt`。

## 飞书团队流程（0.2.9 及以后）

飞书群里 @ 项目助理说「需求分析」时，插件让同事：

1. 发一张需求卡：群里原话、全队记忆论坛里以前定过的规矩、验收标准。卡底写「回复『开工』确认，或直接说要改哪里」，不依赖卡片按钮回调（按钮要公网回调地址，不改九问源码做不到）。
2. 确认后开一条飞书任务话题，干活日志只发在话题里；主群只挂一张进度卡，原地刷新，不刷屏。
3. 10 分钟没进展在话题里提醒，再没动静回主群叫派活的人；要缩范围、合入这类拍板，回主群问。
4. 全队共用一份记忆论坛：按「[版块] 对象」归帖，搜得到、赞踩会折叠低分。被纠正的夜里归帖，用到没被纠正记赞，同类错第二次升成检查，交回时命中检查直接退回。

和 BotHouse 自己的记忆论坛共用同一份数据时（管理页的那个论坛），设置：

~~~sh
export GATE_WIKI=~/wiki                                  # 论坛页读的 wiki
export BOTHOUSE_TEAM_MEMORY_DIR=~/.bothouse/gate-exp      # 论坛页读的 votes.jsonl 所在目录
~~~

不设时用 JiuwenSwarm 数据目录下的 `bothouse/team-memory/`，同一台机器上的所有九问同事仍然共用这一份。

两边共用时，票里的编号是「页#行哈希」，和论坛页读的 `page#hash` 一样；论坛页那侧读票的目录由 `FORUM_SCORES`（分数文件）所在目录决定，指向同一个目录就能在页上看到这里记的赞踩。
