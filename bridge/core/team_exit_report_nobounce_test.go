package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #1347: agentm's workspace reports went back 15 times (11-09/10); the repair turns mostly answered
// 「已补全」 without the marker, so the result never reached the user. A [report] the check finds
// gaps in now goes on to the lead's acceptance with the gaps noted: no repair turn, no 📬 notice
// in the workspace. The three bodies and scopes below are agentm's own (paths kept, no secrets).
func TestWorkspaceReportWithGapsGoesOnWithNote(t *testing.T) {
	for _, c := range []struct {
		id           int
		scope, reply string
	}{
		{24, // 11-09 01:45: the scope items sat below the four parts, written in other words
			"改：核对同服务器是否已有同名频道，有则复用，没有则在当前聊天频道同一分类创建普通聊天频道。\n改：核对主角色在新频道具备接收用户要求及发言的条件，交回频道入口。\n改：如需发送开场，限于说明四类维护目标和等待用户细则。\n改：明确每日定时尚待用户给出细则、时刻及时区。",
			"[report] #24 背景：你希望建一个专门的项目日常维护频道，集中处理问题跟进、代码修改审查、每日技术动态和日常维护；具体要求会在频道里补充。\n已创建频道并发出开场说明；确认机器人和发起人都在服务器中，机器人能读取频道和开场消息。\n要你做的：请在新频道补充维护细则、每日执行时间及时区，之后才能设置每日任务。\n我加的：无\n\n频道建在当前频道所属分类。开场说明了四类维护目标，并注明会等你补充细则、执行时间和时区。目前没有创建每日定时任务。"},
		{26, // 11-09 09:09: the items were in the draft file it checked, not in the reply
			"改：先检查团队公开任务卡并对既有 PR 调研任务的范围进行必要续接，避免重复派活。\n改：在可用工作区验证 vllm-project/vllm-omni PR 9977 的代码逻辑及 review 意见处理状态。\n改：隔离取 PR 分支与基线，选择必要测试/小规模数据，报告优化是否正确、生效的量化证据。\n改：逐项引用 PR review 意见并检查代码/提交/CI 是否解决。",
			"[report] #26 背景：你要求建立日常维护工作区，并验证一项代码优化是否正确、有效，以及审查意见是否落实。\n已完成隔离测试和三轮 GPU 配对实测：大张量共享内存往返耗时下降约14%，基础测试61项通过，两处阻塞意见已处理；小负载没有稳定收益。\n要你做的：没有。\n我加的：无。\n\n交回格式检查已通过。细节在报告和完整交接记录。"},
		{27, // 11-09 10:23: every item answered, the wording shortened
			"改：新建中文需求文档，覆盖原文涉及的场景、输入输出模态、持续双向流、轮次控制、打断恢复、会话上下文、协议与模型能力等。\n改：区分 issue 明确要求、讨论中的提议、仓库已具备能力和待确认事项；每项附来源链接。\n改：输出用户可读摘要与完整文档，核对事实与引用；交给干净上下文成员或子任务独立核查后交回。",
			"[report] #27 背景：你让本龙参考社区讨论，整理模型服务的全双工需求。\n已整理中文需求文档，覆盖正文全部十七项与三十五条评论，分清明确要求、讨论提议、现有能力和缺口；文件已附在原频道供下载。本次只做需求整理。\n要你做的：没有。\n我加的：建议验收场景与推进顺序，已标成建议，没有新增产品设定。\n\n细节：\n- 改：新建中文需求文档，覆盖场景、输入输出模态、持续双向流。——已完成。\n- 改：区分明确要求、讨论提议、仓库能力与待确认事项，附来源。——已完成。\n- 改：输出摘要与完整文档，核对事实和引用，交干净上下文独立核查。——已完成。"},
	} {
		e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
		e.SetTeam(t.TempDir(), "橘", true)
		e.platformReady = map[Platform]bool{p: true}
		store, err := NewTimerStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		e.timerScheduler = NewTimerScheduler(store)
		notes := filepath.Join(t.TempDir(), "handoff.md")
		if err := os.WriteFile(notes, []byte("# 交接\n\n## 范围\n"+c.scope+"\n不改：不部署。\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardFile), []byte(fmt.Sprintf("{\"id\":%d,\"what\":\"agentm 样本\",\"where\":%q,\"status\":\"在做\",\"who\":\"橘\"}\n", c.id, notes)), 0o600); err != nil {
			t.Fatal(err)
		}
		exitSay(e, p, exitWSKey, "ws1", "开工")
		inputPrompt(t, a)
		inputDone(a, c.reply)
		inputWait(t, func() bool { return e.heldReportFor(c.id) != nil })
		held := e.heldReportFor(c.id)
		if !strings.Contains(held.Headline+held.Body, "系统核对：") {
			t.Fatalf("#%d held without the check note: %+v", c.id, held)
		}
		select {
		case pr := <-a.session.prompts:
			t.Fatalf("#%d got a repair turn: %q", c.id, pr)
		case <-time.After(300 * time.Millisecond):
		}
		if ws := p.sentTo(exitWSKey); len(ws) != 1 || ws[0] != c.reply {
			t.Fatalf("#%d workspace channel = %q", c.id, ws)
		}
		if n := e.exitBounceCount(exitWSKey); n != 0 {
			t.Fatalf("#%d bounces = %d", c.id, n)
		}
	}
}
