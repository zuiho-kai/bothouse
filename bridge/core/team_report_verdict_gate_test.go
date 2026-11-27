package core

import (
	"net/http"
	"strings"
	"testing"
)

func TestVerdictGateProblem(t *testing.T) {
	rec := &pendingReport{Board: 46}
	cases := []struct {
		name    string
		verdict string
		want    string // substring of the refusal, "" for accepted
	}{
		{"checked against the user's goal", "逐条：修汇报做到了，线上日志有 report posted", ""},
		{"all items done", "逐条都做到了，用户原话要的结果在日志里", ""},
		{"absolved unread", "没看的部分：无。逐条都做到了", ""},
		{"only numbers checked", "只核了数字表，未读 summary 全文", "没看完/没核"},
		{"goal not met", "结论没过关、最近差 1 个点、建议换路，放行", "目标没达到"},
		{"left to the user", "逐条做完了，等用户定下一步", "决定留给了别人"},
		{"left to the lead and user", "等主角色和用户定", "决定留给了别人"},
		{"not done", "第 3 条没做到，先放行", "目标没达到"},
		{"one item left undone", "逐条：用户原话 ①做到 ②做到 ③没做到，③已另开 #47 接着做", "目标没达到"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := verdictGateProblem(rec, tc.verdict)
			if tc.want == "" {
				if got != "" {
					t.Fatalf("verdict %q refused: %s", tc.verdict, got)
				}
				return
			}
			if !strings.Contains(got, tc.want) {
				t.Fatalf("verdict %q: got %q, want %q", tc.verdict, got, tc.want)
			}
		})
	}
}

// A progress report (等外部) is not final: its verifier may report a partial check.
func TestVerdictGateSkipsProgressAndBatch(t *testing.T) {
	for _, rec := range []*pendingReport{{Board: 46, Waiting: true}, {Board: 46, Batch: true}} {
		if got := verdictGateProblem(rec, "没过关，等用户定"); got != "" {
			t.Fatalf("progress/batch report refused: %s", got)
		}
	}
}

// The refused pass keeps the report held: nothing reaches the chat and the lead can still ask or
// send the work back in the same turn.
func TestHeldReportPassRefusedWhenVerdictSaysUnchecked(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	if w := verdictCall(t, e, 46, "pass", "只核了数字表，未读 summary 全文"); w.Code != http.StatusConflict {
		t.Fatalf("unchecked pass = %d %s", w.Code, w.Body)
	}
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("posted on a refused pass: %q", got)
	}
	rec := e.heldReportFor(46)
	if rec == nil || !rec.Held {
		t.Fatalf("refused pass ended the held report: %+v", rec)
	}
	if w := verdictCall(t, e, 46, "pass", "逐条：修汇报做到了，线上日志有 report posted"); w.Code != http.StatusOK {
		t.Fatalf("valid pass after refusal = %d %s", w.Code, w.Body)
	}
	if got := p.sentTo("discord:chat1"); len(got) != 1 {
		t.Fatalf("valid pass posted %d times", len(got))
	}
}
