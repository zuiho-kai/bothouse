package codex

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestReportedContextWindow(t *testing.T) {
	var _ core.ContextWindowReporter = (*appServerSession)(nil)
	var _ core.ContextWindowReporter = (*codexSession)(nil)
	s := &appServerSession{}
	if w := s.ReportedContextWindow(); w != 0 {
		t.Fatalf("before any usage: %d", w)
	}
	s.context = &core.ContextUsage{UsedTokens: 1, ContextWindow: 258400}
	if w := s.ReportedContextWindow(); w != 258400 {
		t.Fatalf("app-server window = %d", w)
	}
	cs := &codexSession{contextUsage: &core.ContextUsage{UsedTokens: 1, ContextWindow: 258400}}
	if w := cs.ReportedContextWindow(); w != 258400 {
		t.Fatalf("exec window = %d", w)
	}
}
