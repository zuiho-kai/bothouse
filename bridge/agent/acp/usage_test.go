package acp

import (
	"github.com/chenhg5/cc-connect/core"
	"testing"
)

func TestCursorQuotaCapability(t *testing.T) {
	var a core.Agent = &Agent{authMethod: "cursor_login"}
	if _, ok := a.(core.UsageReporter); !ok {
		t.Fatal("Cursor ACP has no account quota reporter")
	}
	if !a.(*Agent).SupportsUsageReporting() {
		t.Fatal("Cursor quota disabled")
	}
	if (&Agent{authMethod: "other"}).SupportsUsageReporting() {
		t.Fatal("generic ACP advertised Cursor account")
	}
}
