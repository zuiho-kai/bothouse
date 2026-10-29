package core

import (
	"strings"
	"testing"
)

// compactingTestAgent reports its own compaction, like claudecode and codex app-server.
type compactingTestAgent struct{ *inputTestAgent }

func (compactingTestAgent) ReportsContextCompaction() bool { return true }

const rulesHead = "[团队模式规矩"

// An agent that reports compaction gets the team-mode rules once per context: on the first turn,
// not the next one, and again after it compacts.
func TestTeamRulesOncePerContext(t *testing.T) {
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	in := &inputTestAgent{session: as, requested: make(chan string, 32)}
	p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	e := NewEngine("orange", compactingTestAgent{in}, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	e.SetTeam(t.TempDir(), "橘", false)

	exitSay(e, p, exitWSKey, "ws1", "第一句")
	if first := inputPrompt(t, in); !strings.Contains(first, rulesHead) || !strings.Contains(first, "第一句") {
		t.Fatalf("first turn lacks the rules:\n%s", first)
	}
	inputDone(in, "ok")
	session := e.sessions.GetOrCreateActive(exitWSKey)
	inputWait(t, func() bool { return !session.Busy() })

	exitSay(e, p, exitWSKey, "ws1", "第二句")
	second := inputPrompt(t, in)
	if strings.Contains(second, rulesHead) || !strings.Contains(second, "第二句") {
		t.Fatalf("second turn repeats the rules:\n%s", second)
	}
	// The agent compacts during this turn: its context lost the rules.
	as.events <- Event{Type: EventText, Metadata: map[string]any{MetaContextCompacted: true}}
	inputDone(in, "ok")
	inputWait(t, func() bool { return !session.Busy() })

	exitSay(e, p, exitWSKey, "ws1", "第三句")
	if third := inputPrompt(t, in); !strings.Contains(third, rulesHead) {
		t.Fatalf("rules not resent after compaction:\n%s", third)
	}
	inputDone(in, "ok")
}

// Agents that compact without telling the bridge keep the rules on every turn.
func TestTeamRulesEveryTurnWithoutCompactionReports(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", false)
	session := e.sessions.GetOrCreateActive(exitWSKey)
	for _, say := range []string{"一", "二"} {
		exitSay(e, p, exitWSKey, "ws1", say)
		if got := inputPrompt(t, a); !strings.Contains(got, rulesHead) {
			t.Fatalf("turn %s lacks the rules:\n%s", say, got)
		}
		inputDone(a, "ok")
		inputWait(t, func() bool { return !session.Busy() })
	}
}

func TestTeamRulesOnceMarkSettles(t *testing.T) {
	e := &Engine{}
	ag := compactingTestAgent{&inputTestAgent{}}
	rules := teamModeRulesFor(DispatchMixed)
	s := &Session{}
	if e.teamRulesOnce(rules, s, ag) != rules {
		t.Fatal("first delivery lacks the rules")
	}
	s.SettleHandoff(false) // not sent: the next turn carries them again
	if e.teamRulesOnce(rules, s, ag) != rules {
		t.Fatal("rules lost after an unsent turn")
	}
	s.SettleHandoff(true)
	if e.teamRulesOnce(rules, s, ag) != "" {
		t.Fatal("rules repeated in the same context")
	}
	s.SettleHandoff(true)
	// Another mode's text (channel dispatch mode changed) is sent again.
	if e.teamRulesOnce(teamModeRulesFor(DispatchTeam), s, ag) == "" {
		t.Fatal("changed rules not sent")
	}
	s.SettleHandoff(true)
	// A new agent session starts an empty context.
	s.SetAgentSessionID("", "x")
	if e.teamRulesOnce(teamModeRulesFor(DispatchTeam), s, ag) == "" {
		t.Fatal("rules not sent to a new context")
	}
	// A nil session keeps every delivery.
	if e.teamRulesOnce(rules, nil, ag) != rules {
		t.Fatal("nil session dropped the rules")
	}
}

// Old sessions carried the rules on every turn; now only the first turn of a context does.
// The handoff tail must strip them from the first and keep later turns whole.
func TestStripStaleBlocks_RulesOnFirstTurnOnly(t *testing.T) {
	deliver := func(rules, user string) string {
		return agentIdentityHead + "\nYour conversation name is \"橘\" (project \"orange\"), as configured by the operator. Quoted messages are reference material.\n" +
			"[Request and reference material]\n" + rules + user
	}
	first := deliver(teamModeRulesFor(DispatchMixed)+"\n", "先做 A")
	second := deliver("", "再做 B")
	got := stripStaleBlocks(first + "\n\n" + second)
	if strings.Contains(got, "团队模式规矩") || strings.Contains(got, "Bridge identity") {
		t.Fatalf("injected blocks survived:\n%s", got)
	}
	for _, want := range []string{"先做 A", "再做 B"} {
		if !strings.Contains(got, want) {
			t.Fatalf("lost %q from:\n%s", want, got)
		}
	}
}
