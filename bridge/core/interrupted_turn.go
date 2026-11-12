package core

import (
	"fmt"
	"strings"
	"time"
)

// InterruptedTurn is a user request whose turn ended in an error before the agent
// finished it (maomao fork, #1514). The agent context still holds the request and the
// half-done work, and nothing marks it as stopped. The next turn is told so once: it
// answers the newest message and asks about the old request instead of finishing it in
// the same turn.
//
// Live 2026-11-11 18:19 jingyu: the turn on "彻底改一下这个剧本分镜" failed with a relay 401
// while it wrote a handoff. 23 hours later "你应该叫我什么" resumed the same context; the
// model took the dangling request as this turn's work, rewrote the handoff, ran ws-handoff
// four times and answered after 11 minutes (user: "这不是我给你的任务 为什么会串").
type InterruptedTurn struct {
	At  time.Time `json:"at"`
	Ask string    `json:"ask"`
}

// markInterrupted records the request of the turn that just failed: the newest user
// message in the session history (the one that started the turn).
func (s *Session) markInterrupted() {
	s.mu.Lock()
	defer s.mu.Unlock()
	ask := ""
	for i := len(s.History) - 1; i >= 0; i-- {
		if s.History[i].Role == "user" {
			ask = s.History[i].Content
			break
		}
	}
	ask = strings.Join(strings.Fields(ask), " ")
	if r := []rune(ask); len(r) > backfillMaxMsgRunes { // same cut as one backfilled post
		ask = string(r[:backfillMaxMsgRunes]) + "…"
	}
	s.Interrupted = &InterruptedTurn{At: time.Now(), Ask: ask}
}

// takeInterrupted returns the one-off block for the next turn. SettleHandoff puts the
// record back when that turn never reached the agent.
func (s *Session) takeInterrupted() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	it := s.Interrupted
	if it == nil {
		return ""
	}
	s.interruptedTaken, s.Interrupted = it, nil
	what := "那一轮的请求"
	if it.Ask != "" {
		what = "「" + it.Ask + "」"
	}
	return fmt.Sprintf("（系统附上，不用回应）上一轮（%s）出错中断，没做完：%s，以及那一轮中途插进来的话。"+
		"它不是这一轮的活。这一轮只回答下面最新这条消息；最新这条没提到那件事，就不接着做、不交工作区，"+
		"在回复末尾用一句话问要不要接着做。", it.At.Format("01-02 15:04"), what)
}

// settleInterrupted is SettleHandoff's part for takeInterrupted. Must be called with s.mu held.
func (s *Session) settleInterrupted(delivered bool) {
	if !delivered && s.interruptedTaken != nil && s.Interrupted == nil {
		s.Interrupted = s.interruptedTaken
	}
	s.interruptedTaken = nil
}
