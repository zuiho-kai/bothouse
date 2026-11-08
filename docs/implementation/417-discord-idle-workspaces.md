# Discord 空闲工作区收纳

关联 Issue #1351。工作区最后一项任务结束或暂停、放回共享池后，Discord 适配器将频道移入「空闲工作区」分类；首次使用时尝试创建分类。再次认领或复用时移回共享池的活动分类。归还后的异步搬动会重新检查归属，避免把刚被认领的频道收走。

core 通过可选接口 `TeamWorkspaceShelver` 调用平台能力，以 `TeamChannel.Shelved` 将收纳后的工作区继续计入共享池的复用、编号和列表。其它平台不实现该接口，沿用原流程。权限和网络错误只记录日志，不阻断释放或派活。

验证（2026-11-09，macOS）：

- `cd bridge && go test -tags no_web ./core ./platform/discord -run 'Test(TeamWorkspace|Shelve|Unshelve|Workspace)' -count=1` 通过。修正了权限测试将“已在空闲分类”的频道误当作待搬频道的 fixture。
- 显式启用的 `TestLiveIdleCategory` 在真实 Discord 创建了测试频道，创建「空闲工作区」分类时收到 HTTP 403、code 50013（Missing Permissions）。测试频道已由清理步骤删除；搬入、搬回未完成真实验收。
- Windows：无 Windows 特有代码；相同生命周期逻辑已在 Mac 定向测试，真实 Discord 验收仍受权限阻塞。
- 干净上下文非作者只读审稿未发现阻断问题，未重复运行测试。

权限前提：自动创建分类要求机器人在服务器级有「管理频道」；也可以由服务器管理员先创建该分类并授予机器人该分类的管理权限。Discord 客户端的折叠状态由用户控制，需要手动折叠一次。没有分类的目标频道暂不能通过当前 SDK 的 ChannelEdit 清空 parent_id；这种情况记录错误、继续派活，频道仍在空闲分类。

未合并、未部署、未重启。撤销代码后停止自动搬动；已经移动的频道需要从 Discord 手动挪回。
