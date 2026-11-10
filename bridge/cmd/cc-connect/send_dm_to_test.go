package main

import "testing"

func TestSendDMToFlag(t *testing.T) {
	t.Setenv("CC_SESSION_KEY", "discord:guild-chan")
	req, _, err := parseSendArgs([]string{"--dm", "--to", "200000000000000002", "-m", "hi"})
	if err != nil {
		t.Fatal(err)
	}
	if !req.DM || req.DMTo != "200000000000000002" || req.FromSession != "discord:guild-chan" || req.SessionKey != "" {
		t.Fatalf("req = %+v", req)
	}
	if _, _, err := parseSendArgs([]string{"--to", "2", "-m", "hi"}); err == nil {
		t.Fatal("--to without --dm must be rejected")
	}
}
