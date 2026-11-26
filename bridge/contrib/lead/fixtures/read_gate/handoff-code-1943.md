# 交接：读材料的活，交回必须逐条写每个材料讲了什么

## 用户原话
- [11-24 12:36] zuiho_kai：「然后那么多文章为什么只看两篇？你他妈就不能并行读吗，其他都丢失了是吧」
- [11-24 12:52] zuiho_kai：「你刚刚只看了两个网站，其他几个你看了没」
- [11-24 13:16] zuiho_kai：「那你告诉他们在看什么东西啊？我操，你告诉我你干嘛？你在」
- [11-24 13:20] zuiho_kai：「首先把这问题修一下，怎么避免以后再出现这种问题」

## 总目标
用户给了多条链接/视频/文章让看时，工作区交回和主角色转话都要逐条写「这个讲了什么、和我们什么关系」，不能只报「看完了、写了拆解」。程序拦，不靠记。

## 现象和根因
- 现象：#1929 工作区 12:04 就把 10 个来源全读完写进笔记，但交回只写「视频和文章都看完写成了拆解」；橘转话也只说过程。用户连问三次才拿到内容。
- 根因：交回格式只有背景/做了什么/要你做的/我加的四段，读材料的活内容全留在笔记里不上聊天频道；wiki 教训表 reader-first.md 第 22、29 行已有同一条经验，第二次复犯，按 R-second 要改成检查。

## 范围
- 改：ws-up --report 的检查（在 /Users/zuiho/.bothouse/collaboration/lead/ 下，具体文件待工作区查）：交接「用户原话」里有 2 个及以上链接/BV 号时，report 里要有不少于链接数的逐条内容行（每条带来源名），不够就拒交并提示。
- 改：在 ~/wiki/rules/house-rules.toml 对应那条的 checks 里登记这个检查，跑 python3 ~/wiki/bin/rules.py render。
- 参照实现：同目录 _handoff_rules.py / _added_judge.py 现有的拒交写法。

## 对象核对
- 「这问题」→ 读了材料不报内容、只报过程（#1929 交回原文见任务帖 1574618141173219328）
- 「以后再出现」→ 所有工作区交回读材料类活的时候

## 我加的（原话没有）
- 用「原话里链接数」判断是不是读材料的活、要求逐条行数不少于链接数：这是最简单能程序判的口径。

## 验收
拿 #1929 那份交回原文重放检查应被拒；补上逐条内容后应通过；普通代码活（原话没链接）不受影响。

## 原话出处（程序附）
（交活时程序附：开工先读这里的原始对话，再读总部判断那节；交接正文是主角色的转述，和原话冲突时信原话）
- 聊天频道：discord:1558868087456014521
- 时间窗：11-24 12:26 到交活
- 讨论原文：/Users/zuiho/.bothouse/roles/maomao/notes/handoff-read-report-gate-1124.原话.md（13 条，用户和主角色每条消息按时间原样；主角色的话只作参考）
- 读原话：sed -n '1,400p' '/Users/zuiho/.bothouse/roles/maomao/notes/handoff-read-report-gate-1124.原话.md'
- 主角色交活时的会话记录：/Users/zuiho/.claude/projects/-Users-zuiho--bothouse-roles-maomao/bdcb37b6-3375-4ec7-b602-836fb856707d.jsonl
- 时间窗外再找：/Users/zuiho/.bothouse/collaboration/lead/chanlog <关键词> --since 11-24 --full

## 旧定案（程序搜出）
（交活时程序按原话和总目标搜 wiki、历史会话和频道原话，区分用户定案与具名队友意见；队友意见不等于用户拍板，和交接冲突时以用户原话为准，拿不准先问聊天频道的主角色，不直接问用户）
- 用户原话「快速调用全部算力学习一下，然后对比我们的，怎么快速改进」：学外部材料时并行开多路读原文，各路回来直接出快改清单 ——~/wiki/tooling/workflow/workflow/preferences/work-process/research-flow.md:51
- 用户否掉「一句话版」（原话「太粗了，有没有细一点的」），要求逐条展开 ——~/wiki/misc/research/gosim/gosim-shenzhen-2026.md:39
- 用户说「这个你并行搞一下，试一下，然后核心还是刚刚我说的」：要求并行去做，核心按他刚说的来 ——~/wiki/bots/chat-bots/bridge/bots/bot-failure-reflection.md:24
- 用户原话「你并行一下怎么跑题了，工资的事情还没说完呢」：用户正在问的事没说完前，不并行开别的修复 ——~/wiki/bots/team-collab/comms/team-payroll-points.md:36
- 用户原话「你重新思考一下，要定位问题，不要直接说不行，现象是什么，根因是什么」：遇到问题要定位现象和根因，不直接下结论 ——~/wiki/tooling/workflow/rules/recurrence/rule-candidates-recurrence/task-practices.md:141

## 交回骨架
（交活时程序附：交回时照抄填空，每个「（待填」都换成实话。ws-up --report 会先检查，下面三类会退回：①细节之前的四段每段最多两句、说人话，不能出现文件名、路径、分支名、带下划线/连字符/驼峰的英文词、反引号、首行以外的 #编号、表格（这些都放细节里；引用户原话时里面的文件名也换成大白话）；②「入口自验」那行或紧跟的几行要有 ``` 包住的命令输出，或真实存在的文件路径、链接；③范围里每条「改」都要逐条写到。细节写短：每条一两句结果，命令输出只贴关键几行。这一节不算范围。）
```
[report] #1943 背景：（待填：这件事是什么、用户当时怎么说的、当初有哪几项）
（待填：做了哪几项、各改成什么、上线没有）
要你做的：（待填：要用户拍板或只有用户能做的事；没有就写「没有」）
我加的：（待填：用户原话里没有、自己加的设定；没有就写「无」）
细节：
入口自验：（待填：用户实际用的入口和在那里走一遍的结果；下面紧跟截图/录屏/成品路径或链接，或 ``` 包住的命令输出）
交接范围逐项：
- 改：ws-up --report 的检查（在 /Users/zuiho/.bothouse/collaboration/lead/ 下，具体文件待工作区查）：交接「用户原话」里有 2 个及以上链接/BV 号时，report 里要有不少于链接数的逐条内容行（每条带来源名），不够就拒交并提示。 —— （待填：结果和证据，没做写原因）
- 改：在 ~/wiki/rules/house-rules.toml 对应那条的 checks 里登记这个检查，跑 python3 ~/wiki/bin/rules.py render。 —— （待填：结果和证据，没做写原因）
```

## 手里现成的（程序列出）
可能有关的现成东西（程序按任务名和原话找的），用得上才打开：
- 上一棒 #1929「看别人记忆插件，处理推送劣化」（等外部（13:38 再看）：用户 12:34 原话「太久了直接截止，看看什么情况」，主角色转达“别重跑，等用户下一步”；他说继续就分开跑、一次一组（单组预计一刻钟内）。，11-24 12:38）：交接 /Users/zuiho/.bothouse/roles/maomao/notes/handoff-dsh-mem-refs-1124.md；里面写到、现在还在：~/.bothouse/gate-exp/push.jsonl、~/work/、~/.bothouse/gate-exp/votes.jsonl
- 上一棒 #1710「汇报回主频道」（已完成，11-16 18:44）：交接 /Users/zuiho/.bothouse/roles/maomao/notes/handoff-report-main-channel-1116.md；里面写到、现在还在：~/.bothouse/turn-journal/、~/.bothouse/logs/bothouse.log、~/.bothouse
- 现成做法 bothouse-report-skeleton：写工作区交回（[report]/[ask]）前，用 bothouse report skeleton 生成交回骨架、检查（/Users/zuiho/.claude/skills/bothouse-report-skeleton/SKILL.md）
- 现成做法 article-read：用户发来文章链接（公众号、博客、新闻、长帖）要读和总结时用：脚本抓全文、图按原位标号并下载，先写不漏节不漏图的全量提纲并（/Users/zuiho/.claude/skills/article-read/SKILL.md）
- 定案：交接里「旧定案（程序搜出）」节 5 条，开工前读

## 模型
模型：保持现状（依据：类型「查根因、复盘」（命中「为什么」））
