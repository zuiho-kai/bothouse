package core

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type modePlatform struct {
	stubPlatformEngine
	mode     string
	explicit bool
	fail     bool
	wait     bool
	mu       sync.Mutex
	byKey    map[string]channelModeSetting
}

type channelModeSetting struct {
	mode     string
	explicit bool
}

func (p *modePlatform) ChannelDispatchMode(ctx context.Context, key string) (string, bool, error) {
	if p.wait {
		<-ctx.Done()
		return "", false, ctx.Err()
	}
	if p.fail {
		return "", false, errors.New("unavailable")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.byKey != nil {
		s := p.byKey[key]
		return s.mode, s.explicit, nil
	}
	return p.mode, p.explicit, nil
}

func (p *modePlatform) set(key string, s channelModeSetting) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.byKey[key] = s
}
func TestChannelDispatchModePriorityAndTimeout(t *testing.T) {
	e := &Engine{}
	e.SetDispatchMode(DispatchSolo)
	p := &modePlatform{mode: DispatchTeam, explicit: true}
	if got := e.channelDispatchMode(p, "room1"); got != DispatchTeam {
		t.Fatal(got)
	}
	p.mode = DispatchMixed
	if got := e.channelDispatchMode(p, "room2"); got != DispatchMixed {
		t.Fatal(got)
	}
	p.explicit = false
	if got := e.channelDispatchMode(p, "room2"); got != DispatchSolo {
		t.Fatal(got)
	}
	p.fail = true
	if got := e.channelDispatchMode(p, "room2"); got != DispatchSolo {
		t.Fatal(got)
	}
	p.wait = true
	start := time.Now()
	if got := e.channelDispatchMode(p, "room2"); got != DispatchSolo {
		t.Fatal(got)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("lookup stalled delivery")
	}
	if got := e.channelDispatchMode(&stubPlatformEngine{}, "discord:room"); got != DispatchSolo {
		t.Fatal(got)
	}
}

func assertModeSection(t *testing.T, prompt, want string, others ...string) {
	t.Helper()
	if !strings.Contains(prompt, teamModeRulesFor(want)) {
		t.Fatalf("prompt missing %s section:\n%s", want, prompt)
	}
	for _, o := range others {
		if strings.Contains(prompt, teamModeRulesFor(o)) {
			t.Fatalf("prompt unexpectedly has %s section:\n%s", o, prompt)
		}
	}
}

func TestChannelAgentInstructionsPerChannelAndAfterChange(t *testing.T) {
	e := &Engine{}
	e.SetDispatchMode(DispatchSolo)
	p := &modePlatform{byKey: map[string]channelModeSetting{
		"room1": {mode: DispatchTeam, explicit: true},
		// Unset channel: gateway reports the auto-created mixed row as not explicit.
		"room2": {mode: DispatchMixed, explicit: false},
	}}

	p1 := e.withChannelAgentInstructions("hello", "u1", false, p, "room1")
	p2 := e.withChannelAgentInstructions("hello", "u1", false, p, "room2")
	assertModeSection(t, p1, DispatchTeam, DispatchSolo, DispatchMixed)
	assertModeSection(t, p2, DispatchSolo, DispatchTeam, DispatchMixed)

	// Changing room1 takes effect on the next call; room2 is unaffected.
	p.set("room1", channelModeSetting{mode: DispatchMixed, explicit: true})
	p1 = e.withChannelAgentInstructions("hello", "u1", false, p, "room1")
	p2 = e.withChannelAgentInstructions("hello", "u1", false, p, "room2")
	assertModeSection(t, p1, DispatchMixed, DispatchTeam, DispatchSolo)
	assertModeSection(t, p2, DispatchSolo, DispatchTeam, DispatchMixed)

	// Clearing the explicit setting falls back to project configuration.
	p.set("room1", channelModeSetting{mode: DispatchMixed, explicit: false})
	p1 = e.withChannelAgentInstructions("hello", "u1", false, p, "room1")
	assertModeSection(t, p1, DispatchSolo, DispatchTeam, DispatchMixed)
}

// inject_team_rules = false: a persona-only bot (QQ chat character) gets neither
// the channel nor the project team-mode rules; the request text is kept.
func TestTeamModeRulesDisabledSkipsBothPaths(t *testing.T) {
	e := &Engine{}
	e.SetDispatchMode(DispatchMixed)
	p := &modePlatform{byKey: map[string]channelModeSetting{"room1": {mode: DispatchTeam, explicit: true}}}
	common := strings.SplitN(teamModeRulesText, "\n## ", 2)[0]
	common = strings.TrimSpace(common)
	if got := e.withChannelAgentInstructions("hello", "u1", false, p, "room1"); !strings.Contains(got, common) {
		t.Fatalf("default should inject team rules:\n%s", got)
	}
	e.SetTeamModeRulesEnabled(false)
	for name, got := range map[string]string{
		"channel": e.withChannelAgentInstructions("hello", "u1", false, p, "room1"),
		"project": e.withAgentInstructions("hello", "", true),
	} {
		if strings.Contains(got, common) || !strings.Contains(got, "hello") {
			t.Fatalf("%s path with rules disabled:\n%s", name, got)
		}
	}
	e.SetTeamModeRulesEnabled(true)
	if got := e.withAgentInstructions("hello", "", true); !strings.Contains(got, common) {
		t.Fatalf("re-enabled project path lost team rules:\n%s", got)
	}
}
