# 8793 分块语音部署记录

Issue #45记录PR #41的实际部署；代码协议和隔离验收见[分块语音](VOICE_STREAMING.md)。2026-10-17 11:11:22（Asia/Shanghai），现有多伙伴8793已切换到合并提交8110ebaafb792fc07175eed32a13dc4bf39f9d91。普通页与讨论页均使用分块播放器。8787保留旧单伙伴入口，Go桥接未重启；#33接话策略不在本次范围。

## 发布与回滚

发布前核对两语音入口无活动任务/讨论，G哥和Cursor均空闲且有原会话；确认进程argv/cwd/日志后保存旧源码与完整启动信息。SIGTERM正常停止旧8793 PID21408，新PID89429启动；PID只是发布时快照，操作前须重查。

| 项目 | 本机位置或结果 |
| --- | --- |
| 固定发布目录 | ~/.cc-connect-maomao/voice/releases/8110ebaafb792fc07175eed32a13dc4bf39f9d91/companion |
| Python解释器 | /Users/zhaixinyang/yijiazi/.venv/bin/python，3.12.13 |
| 启动参数 | -m voice.multi --config /Users/zhaixinyang/conest-issue-26/.local/live-voice/config.json --roles /Users/zhaixinyang/conest-issue-26/.local/live-voice/roles.json |
| 发布备份及日志 | ~/.cc-connect-maomao/backups/voice-stream-20261017-111052/；新日志server.log |
| 配置、名单与原会话 | 继续使用既有文件；字节/权限与两角色session/agent绑定核对一致 |
| 模型和共享记录 | 沿用既有本地Qwen及Whisper模型、两角色音色和共享目录 |
| 保持的进程 | 8787 PID12680，Go桥接PID84453；操作前重查 |

发布源码通过git archive从固定合并提交导出，运行不依赖开发工作区的后续切分支。解释器仍依赖旧yijiazi环境，配置仍依赖issue-26目录；这是本机部署，并未完成#2新机器独立安装。不要删除这些目录或在发布目录直接开发。服务延续此前后台进程方式，尚未为8793增加开机自启。

旧8793使用的Python3.11环境没有mlx_whisper；接口asr_model_ready只检查目录存在。为避免新演示继续缺少识别依赖，本次使用本机已有完整Python3.12语音环境，没有安装或修改全局依赖。新版在该解释器下219项Python测试通过、1项真实ASR测试默认跳过；另已实际导入mlx_whisper并加载本机识别模型。真人麦克风与主观听感仍需人工验收。

备份目录0700，deployment.json与配置0600；其中含完整环境和会话映射，只留本机，不能公开。deployment.json保存原argv/env/cwd、配置/名单哈希、旧voice源码哈希和新版本。old-source/voice为旧代码副本，release.tar为本次固定源码。

回滚前重新核对服务空闲、当前PID、是否有另一操作人；只撤回8793，不恢复旧配置/会话或操作桥接。若进程和旧源码仍匹配发布快照，可运行本机留存脚本：

~~~sh
/Users/zhaixinyang/yijiazi/.venv/bin/python \
  /Users/zhaixinyang/.cc-connect-maomao/backups/voice-stream-20261017-111052/deploy_voice45.py \
  rollback /Users/zhaixinyang/.cc-connect-maomao/backups/voice-stream-20261017-111052
~~~

脚本检查空闲、精确PID和旧源码哈希，正常停止新版，再按原argv/env/cwd追加原server.log启动旧版；不强制杀进程、不删文件、不改配置。若任一前提变化，先人工核对，不能放宽断言盲目回滚。回滚也会恢复旧环境缺少mlx_whisper的限制；尚未实际执行回滚演练。

## 发布核验

- 新8793唯一监听127.0.0.1；普通/讨论页及queue-player.js、app.js、discussion.js与固定发布文件逐字节一致。
- 配置/名单、原8787配置、桥接配置和二进制哈希/权限保持；两伙伴原session/agent绑定保持。8787与桥接PID保持，未替换旧源码或模型。
- 新服务启动无Traceback；新日志独立追加，旧日志保留。发布后真人试听另记，不把HTTP200等同语音验收。

## 上线后的真实链路验收

2026-10-17，使用原G哥和Cursor CLI会话、现有本机Qwen，以及独立浏览器conest-deploy45。通过讨论页输入一项设备轮流讲话的简短建议话题，完整完成G哥→Cursor→G哥→Cursor→G哥总结；没有给伙伴派工或执行项目的权限。

| 发言 | AI文字耗时秒 | 首块秒 | 合成到首播秒 | 全段合成秒 | 音频秒 / 块数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| G哥第一轮，worker首次加载 | 24.149 | 3.638 | 4.145 | 6.490 | 8.32 / 13 |
| Cursor第一轮 | 50.349 | 0.832 | 0.922 | 5.397 | 12.64 / 20 |
| G哥第二轮 | 34.649 | 0.787 | 1.004 | 3.299 | 6.48 / 11 |
| Cursor第二轮 | 19.738 | 0.764 | 0.935 | 3.990 | 8.96 / 14 |
| G哥总结 | 28.612 | 0.696 | 0.784 | 4.269 | 9.76 / 16 |

五段均在全段合成完成前开始播放；74个音频块的浏览器原生playing/ended事件顺序与服务清单完全一致，URL无重复、播放无重叠，只有一个audio元素。五段累计播放时长与完整WAV匹配，服务收到completed后才推进下一位。本次是自动化浏览器的真实播放，不是伪造回执，也不是真人音质评价。

两角色在每段及结束后均保留原session/agent绑定；共享目录记录5个finished、5个discussion_advanced和1个completed。只读检查本次窗口Discord新增0条消息，没有将语音正文发回频道；没有重复进行上一轮跨入口记忆盲查。

原配置/名单字节及权限、桥接二进制与进程、8787进程均与发布前相同。另用系统say生成固定测试音频，转为16kHz单声道PCM，调用已上线8793的/api/transcribe；4.171秒返回包含“语音测试”和“读书”的正确识别，不发送给伙伴。该验证覆盖实际ASR依赖和服务入口，不覆盖真人麦克风或真实环境噪声。首次ASR采样脚本误传空模型路径，在请求前失败；修正为既有配置路径后通过，原始失败保留，服务源码无须修改。

本机证据位于/Users/zhaixinyang/conest-issue-39/.local：deploy45-evidence.json（脱敏指标）、deploy45-service.json（完整轮次，私密）、deploy45-browser.json/txt（原生事件）、deploy45-preflight.json（私密绑定快照）、deploy45-asr.json/log、deploy45-asr-initial.txt、deploy-python312-tests.log。原文、音频和完整环境不入Git。

本次热态合成到首播0.784—1.004秒；AI文字仍耗时19.738—50.349秒，从提交到首播20.673—51.271秒。没有固定随机种子或清空系统缓存；“首次加载”只指新worker的首轮，数据不代表SLA。分块仍有间隙风险，未做预热、真人听感、麦克风或外接硬件验收。后续由用户试听，再按#33处理有必要才补充和避免吵闹。
