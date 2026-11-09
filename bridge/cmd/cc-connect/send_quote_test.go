package main

import (
	"encoding/json"
	"testing"
)

func TestSendReplyToFlagReachesPayload(t *testing.T) {
	req, _, err := parseSendArgs([]string{"-p", "test", "-s", "qq:g:111", "--reply-to", "103", "-m", "quoted text"})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := buildSendPayload(req)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(payload, &wire); err != nil {
		t.Fatal(err)
	}
	if wire["reply_to_message_id"] != "103" {
		t.Fatalf("native reply ID missing: %s", payload)
	}
}

func TestSendReplyToRequiresID(t *testing.T) {
	for _, args := range [][]string{{"--reply-to"}, {"-m", "text", "--reply-to", ""}, {"-m", "text", "--reply-to", " "}} {
		if _, _, err := parseSendArgs(args); err == nil {
			t.Fatalf("missing reply ID accepted: %q", args)
		}
	}
}

func TestSendReplyToInheritsSession(t *testing.T) {
	t.Setenv("CC_PROJECT", "test")
	t.Setenv("CC_SESSION_KEY", "qq:g:111")
	req, _, err := parseSendArgs([]string{"--reply-to", "103", "--message", "text"})
	if err != nil || req.Project != "test" || req.SessionKey != "qq:g:111" || !req.SessionFromEnv || req.ReplyToMessageID != "103" {
		t.Fatalf("inherited request=%+v err=%v", req, err)
	}
}
