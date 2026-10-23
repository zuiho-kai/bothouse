package config

import "testing"

func TestAgentIdentityEnabled_DefaultAndOverride(t *testing.T) {
	p := ProjectConfig{Name: "any"}
	if !p.AgentIdentityEnabled() {
		t.Fatal("default should be true")
	}
	no := false
	p.InjectAgentIdentity = &no
	if p.AgentIdentityEnabled() {
		t.Fatal("explicit false ignored")
	}
	yes := true
	p.InjectAgentIdentity = &yes
	if !p.AgentIdentityEnabled() {
		t.Fatal("explicit true ignored")
	}
}
