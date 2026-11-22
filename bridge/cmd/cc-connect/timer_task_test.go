package main

import "testing"

// A timer a workspace process sets for its own session names the task the process was started
// for (CC_HANDOFF), so the bridge delivers it where that task is (11-21 #928: bgrun's wake went
// to the workspace the task had left). A timer for another session names none.
func TestRunTimerAdd_OwnSessionNamesItsTask(t *testing.T) {
	t.Setenv("CC_HANDOFF", "1795243840735186000")
	t.Setenv("CC_SESSION_KEY", "discord:1")
	if got := runTimerAddCapture(t)["task_handoff"]; got != "1795243840735186000" {
		t.Errorf("timer for the caller's own session: task_handoff = %v, want its CC_HANDOFF", got)
	}
	t.Setenv("CC_SESSION_KEY", "discord:2")
	if got, ok := runTimerAddCapture(t)["task_handoff"]; ok {
		t.Errorf("timer for another session: task_handoff = %v, want none", got)
	}
}
