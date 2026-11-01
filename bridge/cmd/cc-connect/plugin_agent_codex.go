//go:build !no_codex

package main

import (
	"os"

	"github.com/chenhg5/cc-connect/agent/codex"
	"github.com/chenhg5/cc-connect/core"
)

func init() {
	localModelStatus = func() (core.ModelStatus, bool) {
		if os.Getenv("CC_AGENT") != "codex" {
			return core.ModelStatus{}, false
		}
		model := codex.CurrentLocalSessionModel()
		return core.ModelStatus{Agent: "codex", Model: model, Source: "local_session"}, model != ""
	}
}
