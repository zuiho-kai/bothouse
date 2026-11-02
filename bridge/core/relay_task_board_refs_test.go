package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// #72 shared-interface contract (2026-11-02): a dispatch freezes the board item
// it may return to — item id, bound generation, task revision — before
// execution. A worker's response text is never a source for that link.

const relayBoardRefsMessage = "full assignment for #73: read /notes/73.handoff.prompt first"

func boardRefsFixture(t *testing.T, lines string) (*PublicProgress, string, RelayRequest) {
	t.Helper()
	teamDir := t.TempDir()
	if lines != "" {
		if err := os.WriteFile(filepath.Join(teamDir, teamTaskBoardFile), []byte(lines), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	source := NewEngine("source", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(source.cancel)
	source.SetTeam(teamDir, "source", false)
	p, _, _, id := taskRelayFixture(t)
	p.relayBoardRefs = source.relayBoardRefs
	req := taskRelayRequest(id)
	req.Message = relayBoardRefsMessage
	return p, teamDir, req
}

func relayReceipt(t *testing.T, p *PublicProgress, taskID, requestID string) taskRelayRecord {
	t.Helper()
	r := p.records[taskID]
	if r == nil {
		t.Fatalf("no run for %s", taskID)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.record.Relays[requestID]
}

func equalBoardRefs(a, b []taskRelayBoardRef) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestRelayBoardRefsFreezeDispatchGeneration(t *testing.T) {
	lines := `{"id":72,"what":"73 lifecycle","chat":"discord:room:user","bound":"gen-1","where":"/notes/73.handoff.prompt","dispatcher":"source"}` + "\n"
	p, _, req := boardRefsFixture(t, lines)
	if _, _, err := p.beginTaskRelay(req, "Target"); err != nil {
		t.Fatal(err)
	}
	want := []taskRelayBoardRef{{Board: 72, Bound: "gen-1", Revision: 1}}
	if got := relayReceipt(t, p, req.TaskID, req.RequestID).BoardRefs; !equalBoardRefs(got, want) {
		t.Fatalf("board refs = %+v, want %+v", got, want)
	}
	// Committed with the receipt before execution, so a restart cannot lose it.
	b, err := os.ReadFile(filepath.Join(p.dir, req.TaskID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"board_refs"`) || !strings.Contains(string(b), `"gen-1"`) {
		t.Fatalf("board refs not persisted: %s", b)
	}
}

func TestRelayBoardRefsRejectForeignBoardItem(t *testing.T) {
	for name, lines := range map[string]string{
		"other chat":         `{"id":72,"chat":"discord:other","bound":"gen-1","where":"/notes/73.handoff.prompt","dispatcher":"source"}`,
		"not the dispatcher": `{"id":72,"chat":"discord:room:user","bound":"gen-1","where":"/notes/73.handoff.prompt","dispatcher":"target"}`,
		"other handoff path": `{"id":72,"chat":"discord:room:user","bound":"gen-1","where":"/notes/other.handoff.prompt","dispatcher":"source"}`,
	} {
		t.Run(name, func(t *testing.T) {
			p, _, req := boardRefsFixture(t, lines+"\n")
			if _, _, err := p.beginTaskRelay(req, "Target"); err != nil {
				t.Fatal(err)
			}
			if got := relayReceipt(t, p, req.TaskID, req.RequestID).BoardRefs; len(got) != 0 {
				t.Fatalf("untrusted board refs = %+v", got)
			}
		})
	}
	t.Run("no handoff ref in the request", func(t *testing.T) {
		lines := `{"id":72,"chat":"discord:room:user","bound":"gen-1","where":"/notes/73.handoff.prompt","dispatcher":"source"}` + "\n"
		p, _, req := boardRefsFixture(t, lines)
		req.Message = "full assignment for #73 without a handoff path"
		if _, _, err := p.beginTaskRelay(req, "Target"); err != nil {
			t.Fatal(err)
		}
		if got := relayReceipt(t, p, req.TaskID, req.RequestID).BoardRefs; len(got) != 0 {
			t.Fatalf("board refs without a handoff ref = %+v", got)
		}
	})
}

// A delivery retry reuses the committed receipt: it must not re-read the board,
// or a generation that moved on after dispatch would overwrite the frozen one.
func TestRelayBoardRefsSurviveRetryWithSameRequest(t *testing.T) {
	lines := `{"id":72,"chat":"discord:room:user","bound":"gen-1","where":"/notes/73.handoff.prompt","dispatcher":"source"}` + "\n"
	p, teamDir, req := boardRefsFixture(t, lines)
	if _, _, err := p.beginTaskRelay(req, "Target"); err != nil {
		t.Fatal(err)
	}
	moved := strings.ReplaceAll(lines, "gen-1", "gen-2")
	if err := os.WriteFile(filepath.Join(teamDir, teamTaskBoardFile), []byte(moved), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := p.beginTaskRelay(req, "Target"); err == nil {
		t.Fatal("retry of a running dispatch was accepted")
	}
	want := []taskRelayBoardRef{{Board: 72, Bound: "gen-1", Revision: 1}}
	if got := relayReceipt(t, p, req.TaskID, req.RequestID).BoardRefs; !equalBoardRefs(got, want) {
		t.Fatalf("retry recomputed the generation: %+v, want %+v", got, want)
	}
}

// A dispatch whose receipt cannot be committed must not run at all: the frozen
// board generation would otherwise be missing after a restart while the worker
// still executed, so a later return could not be checked against the dispatch.
func TestRelayBoardRefsCommitFailureStopsDispatch(t *testing.T) {
	lines := `{"id":72,"what":"73 lifecycle","chat":"discord:room:user","bound":"gen-1","where":"/notes/73.handoff.prompt","dispatcher":"source"}` + "\n"
	p, _, req := boardRefsFixture(t, lines)
	if err := os.Chmod(p.dir, 0o500); err != nil {
		t.Skipf("cannot make the run directory read-only here: %v", err)
	}
	t.Cleanup(func() { os.Chmod(p.dir, 0o700) }) // same as legacy_data_test.go:131
	if _, _, err := p.beginTaskRelay(req, "Target"); err == nil {
		t.Fatal("dispatch ran although the receipt could not be committed")
	}
	run := p.records[req.TaskID]
	if run == nil {
		t.Fatal("no run record after a failed commit")
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	if receipt, ok := run.record.Relays[req.RequestID]; ok {
		t.Fatalf("a receipt survived the failed commit: %+v", receipt)
	}
}
