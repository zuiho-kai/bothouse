package main

import "testing"

// #75: ws-forward passes --forward so its one-shot notice (the user's own words, which may
// mention 状态/回执) is not taken for a status poll by the anti-spin guard. It must not pass
// --handoff: that path runs the turn as "handoff" and skips inject-if-busy, which would break
// --interrupt.
func TestRunTimerAdd_ForwardFlag(t *testing.T) {
	body := runTimerAddCapture(t, "--forward")
	if v, _ := body["forward"].(bool); !v {
		t.Errorf("--forward: body[forward] = %v, want true", body["forward"])
	}
	if _, ok := runTimerAddCapture(t)["forward"]; ok {
		t.Error("without --forward the body must omit forward")
	}
	if _, ok := body["handoff"]; ok {
		t.Error("--forward must not imply handoff: that path would skip inject-if-busy")
	}

	interrupt := runTimerAddCapture(t, "--forward", "--inject-if-busy")
	if v, _ := interrupt["inject_if_busy"].(bool); !v {
		t.Errorf("--forward --inject-if-busy: body[inject_if_busy] = %v, want true", interrupt["inject_if_busy"])
	}
}
