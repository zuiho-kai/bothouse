# bothouse 人设与记忆（JiuwenSwarm 插件）

JiuwenSwarm 0.2.9 起的插件包。装上后，选了这个插件的对话、以及在「能力」里装备了它的 JiuwenMate 同事（Web、飞书），每次调用模型都会在系统提示词里带上 bothouse 角色的人设和记忆 wiki 说明。

- 人设和记忆来自：本机 bothouse 里跑 JiuwenSwarm 的角色的 `AGENTS.md`；没有这样的角色时，用安装命令建的默认角色 `~/.jiuwenswarm/bothouse/roles/jiuwenswarm/AGENTS.md`（可以直接改，下一次调用就生效）。
- 安装：见 `jiuwenswarm/plugin-pkg/README.md` 的一步装命令；它用 JiuwenSwarm 自己的插件导入和安装接口装这个包，不改 JiuwenSwarm 的文件。
