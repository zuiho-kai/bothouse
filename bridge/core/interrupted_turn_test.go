package core

import (
	"strings"
	"testing"
)

// #1514: a failed turn's request reaches the next user turn once, as "not this turn's work".
func TestInterruptedTurnBlockOnceAndSettle(t *testing.T) {
	s := &Session{}
	s.AddHistory("user", "彻底改一下 重新调整下这个剧本分镜设计")
	s.markInterrupted()

	b := s.takeInterrupted()
	if !strings.Contains(b, "彻底改一下") || !strings.Contains(b, "不交工作区") {
		t.Fatalf("block = %q", b)
	}
	// The turn never reached the agent: the record comes back for the next one.
	s.SettleHandoff(false)
	if again := s.takeInterrupted(); again != b {
		t.Fatalf("not restored after a failed send: %q", again)
	}
	s.SettleHandoff(true)
	if left := s.takeInterrupted(); left != "" {
		t.Fatalf("sent twice: %q", left)
	}
}

func TestInterruptedTurnOnlyOnUserTurns(t *testing.T) {
	e := &Engine{}
	s := &Session{}
	s.AddHistory("user", "做个分镜")
	s.markInterrupted()
	if out := e.withTurnBlocks(s, "k", "q", "cron prompt", false); strings.Contains(out, "出错中断") {
		t.Fatalf("a cron/timer turn took the block: %q", out)
	}
	if s.Interrupted == nil {
		t.Fatal("record lost on a non-user turn")
	}
}
