package antigravity

import (
	"github.com/chenhg5/cc-connect/core"
	"testing"
)

func TestAntigravityQuotaCapability(t *testing.T) {
	var a core.Agent = &Agent{}
	if _, ok := a.(core.UsageReporter); !ok {
		t.Fatal("Antigravity has no account quota reporter")
	}
}
