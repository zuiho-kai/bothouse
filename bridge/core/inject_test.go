package core

import (
	"reflect"
	"sort"
	"strings"
	"testing"
)

func injectNames(m map[string]string) []string {
	var n []string
	for k := range m {
		n = append(n, k)
	}
	sort.Strings(n)
	return n
}

// #1903 (user 11-23「搞统一的管理，然后就只发第一遍，最后二三轮n只是根据记忆论坛搜出来的标题」): every
// block is once per agent context unless named here. Adding a per-turn block means changing this
// test on purpose; a new block that just calls add() or injectBlock is once by default.
func TestInjectEveryTurnLocked(t *testing.T) {
	if got, want := injectNames(injectEveryTurn), []string{"subagent_source", "turn_ctx"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("per-turn blocks = %v, want %v", got, want)
	}
	if got, want := injectNames(injectEvents), []string{"handoff", "interrupted", "lead_handoff", "memory", "outbound", "reply_task"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("event blocks = %v, want %v", got, want)
	}
}

type preambleTestAgent struct{ inputTestAgent }

func (*preambleTestAgent) TurnPreamble() string { return "[model control]" }

// Three turns of one agent context: the first carries every standing block, the second and third
// only the per-turn ones and the message; a new agent session gets them all again.
func TestInjectThreeTurns(t *testing.T) {
	e := newTestEngine()
	e.SetTeam(t.TempDir(), "橘", false)
	e.SetSubagentPolicyEnabled(true)
	s := &Session{AgentSessionID: "a1"}
	ag := &preambleTestAgent{}
	turn := func(user string, fromBot bool) string {
		got := e.withAgentInstructions("Q", user, fromBot, s, ag)
		s.SettleHandoff(true)
		return got
	}
	first := turn("human", false)
	for _, want := range []string{agentIdentityHead, "[Bridge delegation policy]", "[model control]", "[团队模式规矩"} {
		if !strings.Contains(first, want) {
			t.Fatalf("turn 1 lacks %q: %q", want, first)
		}
	}
	if got := turn("human", false); got != "Q" {
		t.Fatalf("turn 2 = %q, want the message alone", got)
	}
	if got := turn("cron", true); got != subagentBotLine+"\nQ" {
		t.Fatalf("turn 3 from cron = %q, want the bot line and the message", got)
	}
	s.SetAgentSessionID("", "x")
	if got := turn("human", false); !strings.Contains(got, agentIdentityHead) || !strings.Contains(got, "[model control]") {
		t.Fatalf("new agent context lacks the standing blocks: %q", got)
	}
}

// A delivery that never reached the agent leaves every once-block unsent.
func TestInjectOnceSettlesUnsent(t *testing.T) {
	e := &Engine{}
	s := &Session{}
	if e.injectBlock(s, "life_page", "v1") != "v1" {
		t.Fatal("first delivery lacks the block")
	}
	s.SettleHandoff(false)
	if e.injectBlock(s, "life_page", "v1") != "v1" {
		t.Fatal("block lost after an unsent turn")
	}
	s.SettleHandoff(true)
	if e.injectBlock(s, "life_page", "v2 edited") != "" {
		t.Fatal("life page resent after an edit (once per context, #1903 C)")
	}
	if e.injectBlock(s, "rules", "r1") != "r1" || e.injectBlock(s, "rules", "r1") != "" || e.injectBlock(s, "rules", "r2") != "r2" {
		t.Fatal("rules: once, again when edited")
	}
}
