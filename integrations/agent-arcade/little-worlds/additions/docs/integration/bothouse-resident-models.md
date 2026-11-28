# Bothouse 居民三维造型

六位内置角色使用手工编排的实体网格。尺度、关节层级和刚性肢体取自 Little Worlds 的 sample courier 与 town resident，材质调用同一 `applyArtMaterial`。每个关节的衣片和装饰合成一次绘制，同造型的多位居民共享几何和材质，各自保留姿态。

| 角色 | 对照原图后保留的造型 |
| --- | --- |
| 橘 | 过腰的橘色长发、花和深色发带、白袖深色上身、双手抱装帧书 |
| 龙娘 | 浅色长发、成对的弯角、尖耳与发侧卷花、浅紫礼裙，背部两片有翼骨的翅膀 |
| 鲸鱼娘 | 深蓝波浪发、浅色褶边头饰与蓝色侧结、鲸图案围裙和后腰蝴蝶结 |
| 彩虹猫 | 猫耳、两侧发卷、紫色发梢、异色眼、彩色星形发夹与胸前蝴蝶结 |
| Grok | 金色高双马尾、冠饰、蝠翼发带、黑金连衣裙与喇叭袖 |
| 岚汐 | 奶白贝雷帽、珊瑚色短发和粉红发梢、侧结、浅色上衣与肩带。原工作台没有她的转面图，后发、后背肩带和鞋由本项目补形。 |

参照为本地 Bothouse 检出 `f2ac90125779010ae3e3a3e9a840fe3525853a86` 的 `dsh/collab/avatars/{orange,dragon,whale,rainbow,grok,lanxi}.png` 与 `dsh/collab/desk/index.html` 的 spriteData。工作台的五张条带各取第 0、4、8 帧，对应正、侧、背。头像 README 将四角色 B 版和 Grok 指定图列在 hunmer/aboutme-pets 来源下；岚汐列在头像清单中。来源说明与部署方的美术授权范围沿用 ASSET-CREDITS.md。原头像及像素帧只在本地参照图中展示，不嵌进这些模型，也不随本次模型提交分发。

调用 `createBothouseResidentModel(key)`，将 `root` 加入场景。局部 +Y 为上、+Z 为前，脚底在局部原点。宿主负责球面法线、朝向和位移。每帧调用 `animate(activity, seconds, reducedMotion, walk)`，walk 为 0 至 1。销毁时调用 `dispose()`。自定义或未知造型传 generic，`setBadge(texture)` 把宿主已经核实的头像显示在胸前徽牌上，传 null 清除；纹理由宿主释放。其他角色不会使用该材质。通用居民的背面和身体由本项目设计，头像没有提供这些信息。

在模型工作树执行 `node tools/check-bothouse-models.mjs <本机Bothouse检出> <证据目录>` 可用隐藏 Edge 实际渲染同场转身及工作姿态。仅提取参照可加 `--references`。回执列出头像 SHA-256、工作台帧数与每个模型的网格数量。
