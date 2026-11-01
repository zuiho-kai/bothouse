package core

import (
	"testing"
	"time"
)

func TestQuotaSwitchProviderDoesNotInheritOldCooldown(t *testing.T) {
	a := &stubModelModeAgent{model: "gpt-4.1", active: "a", providers: []ProviderConfig{{Name: "a", APIKey: "fixture-a"}, {Name: "b", APIKey: "fixture-b"}}}
	e := NewEngine("scope-fixture", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	until := time.Now().Add(time.Hour)
	e.recordQuota(until, "discord:test")
	a.active = "b"
	if got := e.quotaCooling(); !got.IsZero() {
		t.Fatalf("independent provider B inherited provider A quota cooldown: %s", got)
	}
	a.active = "a"
	if got := e.quotaCooling(); !got.Equal(until) {
		t.Fatalf("switching back must retain A cooldown: %s", got)
	}
}
