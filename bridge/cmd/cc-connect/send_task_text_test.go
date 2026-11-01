package main

import "testing"

func TestParseSendTaskText(t *testing.T) {
	req, _, err := parseSendArgs([]string{"--task", "task-1", "--revision", "1", "--delivery-id", "result-1", "--session", "discord:room", "--message", "result"})
	if err != nil || req.TaskText == nil || req.TaskText.Kind != "result" || req.TaskText.Revision != 1 {
		t.Fatal(req, err)
	}
	if _, _, err := parseSendArgs([]string{"--task", "task-1", "--message", "result"}); err == nil {
		t.Fatal("missing delivery identity accepted")
	}
}
