# QQ 手写记忆的受控提交

QQ 独立 DSH/ACP 角色原本能用编辑器或 shell 直接写 `workspace/memory`，只记来源和时间。编辑器钩子拦不住 shell。本集成把整个 DSH 及其子进程放进现有 macOS QQ 沙箱，再加记忆只读约束；沙箱外的提交服务读取可信原话、核对候选正文后原子发布。编辑器的 create、str_replace、insert 都走同一个入口，普通 shell 写其他文件仍可用。

这是集成代码，不能只加载 `loader.mjs` 就声称强制核对已生效。必须由 `memory_guard.py` 在现有 QQ 沙箱外启动 agent，确保实际文件写入受到 OS 约束。不要在已经进入 QQ 沙箱的 DSH 内启动所谓“可信”提交进程。

## 接入边界

现有 QQ 启动器先读取凭据，随后执行 `sandbox-exec -f <QQ策略> node ...`。接入时在**读取凭据之后、进入沙箱之前**，把这个 exec 替换为以下 argv；继续传原来的环境和 Node argv，不重写凭据逻辑，也不改 `CC_PROJECT`、`CC_SESSION_KEY`、`CC_DATA_DIR`：

```text
python3 -I -B /absolute/bothouse/integrations/qq-memory-quote/memory_guard.py
  --memory /absolute/qq/workspace/memory
  --people /absolute/agent-sessions/people
  --profile /absolute/qq/qq-sandbox-v2.sb
  --runtime /absolute/qq/run
  -- /absolute/node --import /absolute/qq/bin/qq-acp-image-fix.mjs
     /absolute/dsh/lib/bin.js --profile acp --patch /absolute/qq/qq-acp.patch.yml
```

这些是 argv 示例，换行不是可直接粘贴的 shell 命令。目录必须已存在；runtime 选短的绝对路径，避免 macOS Unix socket 路径长度限制。保留现有 Node loader；本集成通过追加 `NODE_OPTIONS --import` 组合加载。DSH 文件服务或提示词渲染器接口变化时明确报错，不能静默变成直接写。

`memory_guard.py` 只适配现有 macOS QQ 沙箱；不在其他 OS 上退化为不隔离运行。没有修改安装器、线上启动器或配置，不自动部署。回滚接入只需恢复原启动 argv，已有记忆不迁移、不清空。

## 可信原话与提交规则

- 来源是 `bridge/core/people_said.go` 写出的原始 people JSONL。该入口排除 FromBot、定时/系统身份，只记当前正文；QQ 的原生引用、转发和环境聊天由适配器放在其他字段。已有普通 user/assistant 会话文本不作为真人身份依据。
- 来源查询固定到启动时的 project、QQ session key，保留原记录的 speaker_id、channel、ts；不接收模型提交的 author、原文或外部来源路径自证。私聊、不同群及其他角色的记录不能在当前查询里出现。每个服务有独立 capability，发现另一个会话的 socket 也不能访问它。
- 模型用提示词中的 `node client.mjs sources` 查询来源，再照旧用文件编辑器写入。每条新事实要带 `原话：「…」；来源：<查询返回的完整id>`。原话仍由 people 记录保存，id 是完整记录的 SHA256，身份、场景和时间不是模型自填的证明。
- 人物文件只能引用该 speaker_id 的原话；群文件只能是当前群。保持 `self.md`、`<sender_id>.md`、`group-<chat_id>.md` 的原布局；不迁移至共享 wiki。旧行原样保留，空行和合法标题不是新事实；其他新增行都核对。
- 直接复用共享 ingest 的 `flat`、`quote_ok`、`in_order` 纯定义：去标点/空格后至少四字，短于四字须整行匹配。改字、只来自机器人、缺引文/来源均拒绝，文件保持原字节。
- 排除消息正文里明确的引语、转述行，避免把被引用人的话当发送者自述。脚本只证明逐字来源和元数据归属，不证明自然语言中的事实能由引文推出；隐含转述、讽刺、真假及语义仍须模型判断，不能宣称已做语义真实性验证。
- 服务对整个记忆目录持跨进程锁，版本检查、核对、原子发布在同一段内完成。所有 agent 进程都不能直接写记忆、换目录、覆盖源码或篡改来源；可信进程不执行请求中的命令。失败时不先落盘再回滚。

本集成不负责改造 QQ 原有读取/回复的隐私策略；它约束来源查询和写入，不能把“来源隔离”夸成“agent 已无法读取现有其他场景记忆”。

## 针对性验证

设置已有的隔离目录 `QQ_TEST_ROOT`，运行 `python3 -B -m unittest -v test_memory_guard`。真实工具项还需 `QQ_TEST_PROFILE` 指向 QQ 策略、`QQ_TEST_DSH_MODULES` 指向已安装 DSH 的 `node_modules/@deepseek-ai`。运行位置是本目录。测试把真实策略的三个路径别名换成隔离副本，使用合成 people 记录、独立 HOME/XDG，不调用模型、不连 QQ、不发送测试消息。

三项必验：原话匹配实际落盘，改一字拒绝且字节不变，仅机器人话拒绝且字节不变。另验同人跨群/私聊/项目、不同人、引用/转述来源；真实 DSH 编辑器与 bash 下复验旧绕过、Node 子进程、文件/目录 rename、软硬链接和来源篡改，并确认普通 shell 写入仍可用。测试断言实际文件及工具进程结果，不把“假 CLI 调用成功”当依据。

fixture、socket 和日志保留，不删除文件或目录。服务随测试子进程结束关闭监听，未启动常驻服务。验证前后另对线上规则/配置/记忆及三个角色 wiki 做只读摘要核对。只跑上述定向项，既有共享入口测试不重跑。

## 成本与来源

来源读取、规范化、子串核对和写入都是本地脚本，不调用模型，也没有新增 FIX 模型、重试次数或模型配置。但 QQ 的来源查询是工具调用；如果单独占一轮，模型接收查询结果再编辑会增加后续推理轮次。拒绝后模型改写/重试也可能增加费用。未用真实模型测量，不能承诺总 token、总调用次数或延迟不变。共享 ingest 的成功校验不新增模型调用；失败仍可能走既有 FIX/后备引擎/后续重试。

思路参考 cneicy/astrbot_plugin_shrink 的短引文核对，未复制 AGPL 代码；校验语义复用 bothouse 已有实现。OS 隔离复用现有 QQ Seatbelt 策略，DSH 接入复用已安装的文件服务/提示词 hook，不改 shell 命令黑名单。
