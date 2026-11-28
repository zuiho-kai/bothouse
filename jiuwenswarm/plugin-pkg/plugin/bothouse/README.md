# bothouse 人设与记忆（JiuwenSwarm 插件）

JiuwenSwarm 0.2.9 起的插件包。装上后，选了这个插件的对话、以及在「能力」里装备了它的 JiuwenMate 同事（Web、飞书），每次调用模型都会在系统提示词里带上 bothouse 角色的人设和记忆 wiki 说明。

- 人设和记忆来自：本机 bothouse 里跑 JiuwenSwarm 的角色的 `AGENTS.md`；没有这样的角色时，用安装命令建的默认角色 `~/.jiuwenswarm/bothouse/roles/jiuwenswarm/AGENTS.md`（可以直接改，下一次调用就生效）。
- 安装：见 `jiuwenswarm/plugin-pkg/README.md` 的一步装命令；它用 JiuwenSwarm 自己的插件导入和安装接口装这个包，不改 JiuwenSwarm 的文件。

## 装上以后多出来的能力

- 飞书群「需求分析」→ 需求卡（原话 + 记忆论坛里以前定过的 + 验收标准；回复「开工」确认，或直接说要改哪里）。
- 确认后开任务话题，干活日志只进话题；主群一张进度卡原地刷新。
- 卡住 10 分钟话题提醒、20 分钟回主群叫人；缩范围/合入回主群拍板。
- 全队共用记忆论坛与记忆流程：按「[版块] 对象」归帖、搜索、赞踩折叠、夜间归帖、同类错第二次升检查、交回退回。
- 三个工具：`bothouse_feishu_need_card`、`bothouse_feishu_topic_task`、`bothouse_memory_forum`；流程见 skill `bothouse-team-workflow`。
