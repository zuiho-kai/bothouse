# 分块语音与首播等待

Issue #39解决的是完整文字回答到达后，必须等整段音频生成完才能播放的问题。沿用本机Qwen、角色音色、原会话和共享记忆，先交付第一块音频，后续块继续生成。AI生成文字的耗时不变，尚未增加启动预热。

## 当前行为与合同

- `Speech.synthesize_stream(text, on_chunk, *, voice=None) -> bytes`同步交付完整的24kHz单声道16bit PCM WAV块，返回完整WAV用于重播。文本校验与原`synthesize`一致；系统say单块回退；只有旧`synthesize`的后端仍可使用。
- Qwen worker使用MLX的`stream=True, streaming_interval=0.64`。每帧带请求ID、连续序号，父进程保留未消费字节，不混用buffered readline和select。校验累计token、块数、总字节、采样数及最终完成帧；中途失败不自动重发，不能把已发出的部分当成功。
- 合成端至多4096块，服务接受至多512块；两层都限制300秒、15MB WAV，IPC单帧1MiB、总计21MB，默认worker超时120秒。同步回调必须及时返回且不可重入；不能强制中断任意阻塞回调。缓存完整WAV保留在既有私密缓存目录，不自动删除。
- 轮次在`synthesizing`时返回追加的`audio_chunks`，包含`index/audio_url/duration_seconds`；GET `/api/turn/{id}/audio/chunks/{index}`仅返回有效的已到块。`audio_complete`只有完整合成成功且讨论未停止才为true，原`audio_url`保留整段重播。最近20轮内存缓存同时回收对应块。
- 普通页和讨论页共用`static/queue-player.js`，一个audio元素按序播放，重复查询不重复入队。缺尾块时等待；完整合成成功且所有块播完才上报completed，累计时长必须匹配全段。讨论还须到`awaiting_playback`才确认并安排下一位。
- 停止、隐藏、页面离开、恢复、切换伙伴、查询失败及自动播放拒绝使旧播放意图失效；后续块不会自行恢复播放。用户明确点击才能继续。停止讨论后冻结块发布并拒绝块请求、迟到播放回执和推进；已送达任务仍收尾，已有文字和成功生成的完整WAV可保留。

这是单电脑单用户播放器，不提供跨标签页音频所有权。顺序切换WAV不保证无缝连接；首播提前不等于语速、音质或全部时延都已优化。

## 指标

`timings.tts_first_chunk_ms`为开始合成到首块可用；`tts_ms`为整段合成；`first_playback_ms`为提交到首次浏览器playing回执，`tts_to_playback_ms`仅从开始合成计时。回执来自播放器事件，不证明用户实际听见或理解。

## 2026-10-17 验证

自动检查：macOS Python全量219 passed / 1 skipped（真实ASR模型测试），Node行为测试34 passed，JavaScript语法及git diff检查通过。CI增加强制Node测试，无npm安装或静默跳过。桥接源码没有变化，最终提交的Ubuntu bridge/companion检查见PR。

红绿证据：服务首块回归旧实现2 failed；接入流式后通过。合成端及播放器分别复现首块阻塞后转绿。独立服务审核又发现thinking时可预存completed、停止讨论后仍可下载后续块；新增回归先2 failed / 7 passed，修复后9 passed，合并相关测试40 passed。另一子Agent只读审核合成协议并核对本机MLX源代码，未发现新问题；父Agent审核并实测播放器。两名子Agent已回收。

隔离浏览器使用8794的模拟桥接/受控WAV：暂停后续合成时，两页面都确实播放首块；停止后放行剩余合成，没有恢复播放或派发下一位。停止讨论后块数保持1、audio_complete为false。自动播放拒绝、刷新、隐藏、角色切换、失效回调和失败由Node行为测试覆盖。

8795使用模拟桥接、真实现有Qwen模型和浏览器原生playing/ended事件，数据与共享记录仅在本工作区.local。固定28字文本，未固定随机种子，角色为uncle_fu/serena；不调用真实Discord伙伴、不重复跨入口记忆验收。M3 Pro/18GiB，MLX-Audio0.5.9、MLX0.32.4。

| 场景 | 首块秒 | 从合成到首播秒 | 整段合成秒 | 块数 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 普通页，worker首次加载 | 7.429 | 7.521 | 9.765 | 11 | 完整播放 |
| 普通页，同进程再次合成 | 0.618 | 0.834 | 2.753 | 10 | 完整播放 |
| 讨论第1段，新worker首次加载 | 3.711 | 3.861 | 6.555 | 13 | 完整播放后推进 |
| 讨论第2段 | 0.442 | 0.630 | 2.451 | 9 | 完整播放后推进 |
| 讨论第3段 | 0.439 | 0.633 | 3.476 | 14 | 完整播放后推进 |
| 讨论第4段 | 0.472 | 0.638 | 2.318 | 9 | 完整播放后推进 |
| 讨论第5段 | 0.453 | 0.673 | 3.482 | 13 | 本场完成 |

五段58个块的原生playing/ended逐一相等、顺序一致、URL不重复、没有重叠；每段首播均早于整段生成完，completed累计时长与音频一致。此次“冷”仅指新worker首次加载，不是清除系统缓存；单次测量不代表SLA。没有真人听感评价、硬件、麦克风或真实CLI新一轮验收。

初版普通页采样脚本未取得已落盘的完成回执就断言失败；原失败文件保留，随后保存真实终态与原生播放事件，讨论使用服务终态采集再核对58块。本机证据位于conest-issue-39/.local：stream-service-red.txt、service-review-red.txt、python-tests.log、player-tests.log、qwen-browser-verified.json、qwen-discussion-service.json、qwen-discussion-browser.txt、gate-browser-result.json；原文、音频和完整日志不入Git。

## 发布边界

以上为PR #41开发时的隔离验证，当时未重启生产桥接或8787/8793。后续Issue #45已于2026-10-17 11:11将固定合并版本部署到8793；真实G哥+Cursor五段74块顺序播放和线上ASR接口验证通过，8787仍为旧版本。部署版本、测量与回滚见[部署记录](VOICE_STREAMING_DEPLOYMENT.md)。真人听感、麦克风、预热和无缝播放仍未验收或实现；首个实体以至少两位AI陪伴为目标（#8/#33）。
