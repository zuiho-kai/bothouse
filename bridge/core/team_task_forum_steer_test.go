package core

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/chenhg5/cc-connect/core/team"
)

// steerForumSession 是带 SendMidTurn 的会话（ACP/DSH 的样子）：
// 中途插入走 SendMidTurn，不走会另起一轮的 Send。
type steerForumSession struct {
	*inputTestSession
	mu  sync.Mutex
	mid []string
}

func (s *steerForumSession) SendMidTurn(prompt, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mid = append(s.mid, prompt)
	return nil
}

func (s *steerForumSession) inserted() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.mid...)
}

// steerForumAgent 按 can 报告收不收中途输入，和 ACP 握手后才知道一样。
type steerForumAgent struct {
	*inputTestAgent
	can     bool
	running *steerForumSession
}

func (a *steerForumAgent) SupportsMidTurnInput() bool { return a.can }
func (a *steerForumAgent) StartSession(ctx context.Context, id string) (AgentSession, error) {
	_, err := a.inputTestAgent.StartSession(ctx, id)
	return a.running, err
}
func (a *steerForumAgent) StartSessionStrict(ctx context.Context, id string) (AgentSession, error) {
	_, err := a.inputTestAgent.StartSessionStrict(ctx, id)
	return a.running, err
}

// 任务帖里的回话：空闲时照旧起一轮；忙时 agent 收得下就插进当前这一轮，
// 回执回到帖子；收不下照旧排队。
func TestTaskForumBusyReplySteersRunningTurn(t *testing.T) {
	for _, tc := range []struct {
		name string
		can  bool
	}{
		{"busy, agent takes mid-turn input: inserted", true},
		{"busy, agent without mid-turn input: queued", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, e, inner, base, session := inputFixture(t)
			e.i18n.SetLang(LangChinese)
			running := &steerForumSession{inputTestSession: inner.session}
			e.agent = &steerForumAgent{inputTestAgent: inner, can: tc.can, running: running}
			p := &forumReplySink{inputTestPlatform: base}
			dir := t.TempDir()
			e.team = &teamState{dir: dir, inject: true}
			e.SetGateLocal(true)
			writeForumReplyItem(t, dir, team.TaskBoardFile, teamTaskBoardItem{
				ID: 779, What: "任务帖对接", Who: "worker", Chat: inputTestKey, Status: "在做", WS: "discord:workspace",
			})
			post := func(text string) *Message {
				return &Message{
					SessionKey: "discord:post", ChannelID: "post", Platform: "discord", UserID: "human",
					Content: text, Mentioned: true, ReplyCtx: "post-delivery",
					TaskForum: &TaskForumReply{Board: 779, Thread: "post"},
				}
			}
			pending := func() int {
				e.interactiveMu.Lock()
				defer e.interactiveMu.Unlock()
				n := 0
				for _, st := range e.interactiveStates {
					st.mu.Lock()
					n += len(st.pendingMessages)
					st.mu.Unlock()
				}
				return n
			}
			visible := func() string { return strings.Join(p.getSent(), "\n") }
			const insertedNotice, queuedNotice = "↪ 已插入", "📬 消息已收到，将在当前任务完成后处理。"

			// 空闲：照旧起一轮，带任务事实，不插入也不排队。
			e.ReceiveMessage(p, post("先做第一步"))
			first := inputPrompt(t, inner)
			for _, want := range []string{"先做第一步", "这是任务帖 #779"} {
				if !strings.Contains(first, want) {
					t.Fatalf("idle reply: missing %q in prompt %s", want, first)
				}
			}
			if !session.Busy() || len(running.inserted()) != 0 || pending() != 0 {
				t.Fatalf("idle reply must start a turn: busy=%v inserted=%q pending=%d", session.Busy(), running.inserted(), pending())
			}
			if got := visible(); strings.Contains(got, insertedNotice) || strings.Contains(got, queuedNotice) {
				t.Fatalf("idle reply got a busy receipt: %s", got)
			}

			// 忙：同一个帖子里再回一句。
			e.ReceiveMessage(p, post("加上失败回执"))
			if tc.can {
				mid := running.inserted()
				if len(mid) != 1 || !strings.Contains(mid[0], "加上失败回执") || !strings.Contains(mid[0], "这是任务帖 #779") {
					t.Fatalf("SendMidTurn got %q, want the reply with its task facts", mid)
				}
				if got := visible(); !strings.Contains(got, insertedNotice) || strings.Contains(got, queuedNotice) {
					t.Fatalf("want only the insert notice, got: %s", got)
				}
				if n := pending(); n != 0 {
					t.Fatalf("an inserted reply must not be queued: pending=%d", n)
				}
				inputDone(inner, "receipt-first")
				inputWait(t, func() bool { return !session.Busy() })
				if n := inner.session.normal.Load() + inner.session.strict.Load(); n != 1 {
					t.Fatalf("an inserted reply must not start its own turn: %d turns", n)
				}
			} else {
				if mid := running.inserted(); len(mid) != 0 {
					t.Fatalf("must not insert: %q", mid)
				}
				if got := visible(); !strings.Contains(got, queuedNotice) || strings.Contains(got, insertedNotice) {
					t.Fatalf("want only the queue receipt, got: %s", got)
				}
				if n := pending(); n != 1 {
					t.Fatalf("the reply must wait in the queue: pending=%d", n)
				}
				inputDone(inner, "receipt-first")
				if next := inputPrompt(t, inner); !strings.Contains(next, "加上失败回执") {
					t.Fatalf("queued reply did not run as the next turn: %s", next)
				}
				inputDone(inner, "receipt-second")
				inputWait(t, func() bool { return !session.Busy() })
			}
			p.mu.Lock()
			defer p.mu.Unlock()
			for _, target := range p.targets {
				if target != "post-delivery" {
					t.Fatalf("receipt escaped the post: %v", target)
				}
			}
		})
	}
}
