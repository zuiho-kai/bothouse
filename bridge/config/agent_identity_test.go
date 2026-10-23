package config

import "testing"

func TestAgentIdentityEnabled_ProjectDefaults(t *testing.T) {
	for _, name := range []string{"maomao", "jingyu", "longniang", "gemini", ""} {
		p := ProjectConfig{Name: name}
		if got := p.AgentIdentityEnabled(); got != (name != "maomao") {
			t.Errorf("%s: %v", name, got)
		}
		yes := true
		p.InjectAgentIdentity = &yes
		if !p.AgentIdentityEnabled() {
			t.Fatal("explicit restoration ignored")
		}
	}
}
