package main

import "testing"

// #597 G25: ws-handoff passes --handoff so the wake-up turn opens the automatic card.
func TestRunTimerAdd_HandoffFlag(t *testing.T) {
	body := runTimerAddCapture(t, "--handoff", "--inject-if-busy")
	if v, _ := body["handoff"].(bool); !v {
		t.Errorf("--handoff: body[handoff] = %v, want true", body["handoff"])
	}
	if _, ok := runTimerAddCapture(t)["handoff"]; ok {
		t.Error("without --handoff the body must omit handoff")
	}
}
