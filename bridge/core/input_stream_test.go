package core

import (
	"net/http"
	"testing"
)

func TestInputSpeechStreamIsBoundOptInAndNotTerminal(t *testing.T) {
	api, _, ag, p, _ := inputFixture(t)
	req := inputBoundRequest(t, api, "speech-stream")
	req["stream"] = true
	if code, _ := inputPost(api, req); code != http.StatusAccepted {
		t.Fatalf("stream request rejected: %d", code)
	}
	inputPrompt(t, ag)
	ag.session.events <- Event{Type: EventType("speech_text"), Content: "你好。", SessionID: ag.session.id}
	var got InputResult
	inputWait(t, func() bool { _, got = inputGet(api, "speech-stream"); return got.SpeechText == "你好。" })
	if got.Status != "running" {
		t.Fatal("partial text must not complete task")
	}
	ag.session.events <- Event{Type: EventThinking, Content: "private"}
	ag.session.events <- Event{Type: EventToolUse, Content: "tool internals"}
	inputDone(ag, "你好。")
	got = inputResult(t, api, "speech-stream", "completed")
	if got.SpeechText != "你好。" || len(p.getSent()) != 0 {
		t.Fatalf("leak: %+v", got)
	}
}

func TestInputSpeechRejectsForeignSession(t *testing.T) {
	api, _, ag, _, _ := inputFixture(t)
	req := inputBoundRequest(t, api, "foreign-speech")
	req["stream"] = true
	if code, _ := inputPost(api, req); code != 202 {
		t.Fatal(code)
	}
	inputPrompt(t, ag)
	ag.session.events <- Event{Type: EventType("speech_text"), Content: "not ours", SessionID: "other"}
	got := inputResult(t, api, "foreign-speech", "failed")
	if got.SpeechText != "" {
		t.Fatal("foreign output escaped")
	}
}

func TestInputSpeechDefaultOffAndReplaySettingIsImmutable(t *testing.T) {
	api, _, ag, _, _ := inputFixture(t)
	req := inputBoundRequest(t, api, "default-speech")
	if code, _ := inputPost(api, req); code != 202 {
		t.Fatal(code)
	}
	inputPrompt(t, ag)
	ag.session.events <- Event{Type: EventSpeechText, Content: "not opted in", SessionID: ag.session.id}
	inputDone(ag, "final")
	if got := inputResult(t, api, "default-speech", "completed"); got.SpeechText != "" {
		t.Fatal(got)
	}
	req["stream"] = true
	if code, _ := inputPost(api, req); code != 409 {
		t.Fatalf("same ID cannot change delivery mode: %d", code)
	}
}
