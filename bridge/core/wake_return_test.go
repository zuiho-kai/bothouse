package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// #2024: Discord wakes the same bot's DSH session; DSH's answer comes back to the
// original Discord conversation as its own turn, after the Discord turn has ended.
func TestWakeReturn_DiscordToDSHAndBack(t *testing.T) {
	discord := &stubProactiveSendPlatform{stubMediaPlatform: stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	dsh := &stubProactiveSendPlatform{stubMediaPlatform: stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "dsh"}}}
	agent := &outboundAgent{script: []string{"42"}}
	e := NewEngine("kato", agent, []Platform{discord, dsh}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	api := &APIServer{engines: map[string]*Engine{"kato": e}}
	server := httptest.NewServer(http.HandlerFunc(api.handleWake))
	defer server.Close()

	const origin, dest = "discord:chan-1:user-1", "dsh:desk-1"
	post := func(destKey string) map[string]any {
		body, _ := json.Marshal(map[string]string{"project": "kato", "session_key": destKey, "text": "generate a number", "origin_project": "kato", "origin_session_key": origin})
		resp, err := http.Post(server.URL+"/wake", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusAccepted {
			t.Fatalf("wake status = %d", resp.StatusCode)
		}
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		if out["status"] != "accepted" || !strings.HasPrefix(out["wake_id"].(string), "wk_") {
			t.Fatalf("wake response = %v, want accepted with a wake_id", out)
		}
		return out
	}

	out := post(dest)
	waitFor(t, "result turn in the waking conversation", func() bool {
		for _, p := range agent.sentPrompts() {
			if strings.Contains(p, "[wake result") {
				return true
			}
		}
		return false
	})
	prompts := agent.sentPrompts()
	if len(prompts) != 2 || !strings.Contains(prompts[0], "generate a number") {
		t.Fatalf("prompts = %q, want the wake then its result", prompts)
	}
	ret := prompts[1]
	if !strings.Contains(ret, out["wake_id"].(string)) || !strings.Contains(ret, "has completed") || !strings.Contains(ret, "reply:42") || !strings.Contains(ret, dest) {
		t.Fatalf("result prompt = %q, want the wake id, completed and DSH's reply", ret)
	}
	if dsh.reconstructKey != dest || discord.reconstructKey != origin {
		t.Fatalf("turns ran in dsh=%q discord=%q, want %q and %q", dsh.reconstructKey, discord.reconstructKey, dest, origin)
	}
	if w, ok := lookupWakeReturn(out["wake_id"].(string)); !ok || w.Status != "completed" {
		t.Fatalf("wake record = %+v, want completed", w)
	}

	// A wake whose turn cannot start comes back as failed, not silently lost.
	failed := post("line:nowhere")
	waitFor(t, "failure result", func() bool {
		for _, p := range agent.sentPrompts() {
			if strings.Contains(p, failed["wake_id"].(string)) && strings.Contains(p, "has failed") {
				return true
			}
		}
		return false
	})
}

// A wake without an origin (event hooks) keeps the old one-way reply.
func TestWakeReturn_NoOriginStaysOneWay(t *testing.T) {
	dsh := &stubProactiveSendPlatform{stubMediaPlatform: stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "dsh"}}}
	agent := &outboundAgent{}
	e := NewEngine("kato", agent, []Platform{dsh}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	api := &APIServer{engines: map[string]*Engine{"kato": e}}
	rec := httptest.NewRecorder()
	api.handleWake(rec, httptest.NewRequest(http.MethodPost, "/wake", strings.NewReader(`{"project":"kato","session_key":"dsh:desk-1","text":"hi"}`)))
	if rec.Code != http.StatusAccepted || strings.Contains(rec.Body.String(), "wake_id") {
		t.Fatalf("wake = %d %s, want 202 without a wake_id", rec.Code, rec.Body.String())
	}
}
