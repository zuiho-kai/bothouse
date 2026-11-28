package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func relayWithModels(t *testing.T, ids ...string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var b strings.Builder
		b.WriteString(`{"object":"list","data":[`)
		for i, id := range ids {
			if i > 0 {
				b.WriteString(",")
			}
			b.WriteString(`{"id":"` + id + `","object":"model"}`)
		}
		b.WriteString("]}")
		_, _ = w.Write([]byte(b.String()))
	}))
}

// #2113: the user's relay answered 503 model_not_found for "Opus 4.7"; its ID is claude-opus-4-7.
func TestResolveModelIDDisplayNameToID(t *testing.T) {
	srv := relayWithModels(t, "claude-opus-4-7", "claude-opus-4-7-thinking", "gpt-5.6-terra", "claude-sonnet-4-6")
	defer srv.Close()
	for _, base := range []string{srv.URL, srv.URL + "/v1", srv.URL + "/v1/"} {
		cases := map[string]string{
			"Opus 4.7":        "claude-opus-4-7",
			"Claude Opus 4.7": "claude-opus-4-7",
			"GPT 5.6 Terra":   "gpt-5.6-terra",
			"claude-opus-4-7": "claude-opus-4-7", // an ID is left alone
			"not-listed-id":   "not-listed-id",   // some relays hide models: no space, no change
		}
		for in, want := range cases {
			got, err := ResolveModelID(context.Background(), base, "sk-test", in)
			if err != nil || got != want {
				t.Fatalf("base %s: ResolveModelID(%q) = %q, %v; want %q", base, in, got, err, want)
			}
		}
	}
	if _, err := ResolveModelID(context.Background(), srv.URL, "sk-test", "Gemini 9"); err == nil || !strings.Contains(err.Error(), "claude-opus-4-7") {
		t.Fatalf("unmatched display name: err = %v, want the list of IDs", err)
	}
	if _, err := ResolveModelID(context.Background(), srv.URL, "wrong", "Opus 4.7"); err == nil {
		t.Fatal("display name with an unreadable list must be refused, not written")
	}
}

// #2113 at the wizard's own entry: "Opus 4.7" typed in the model box is saved as claude-opus-4-7,
// both as the provider's model and the agent's model option.
func TestApplyWizardWritesModelID(t *testing.T) {
	noLocalGate(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	srv := relayWithModels(t, "claude-opus-4-7", "claude-sonnet-4-6")
	defer srv.Close()
	store := newMemStore()
	req := WizardRequest{Platform: "discord", Language: "zh",
		Roles: []WizardRole{{Token: t1, AgentType: "claudecode",
			Provider: &WizardProvider{Vendor: "custom", BaseURL: srv.URL + "/v1", APIKey: "sk-test", Model: "Opus 4.7"}}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}, req)
	if !res.OK {
		t.Fatalf("apply failed: %+v", res)
	}
	ju := store.projects["juzi"]
	if ju == nil || ju.Provider == nil || ju.Provider.Model != "claude-opus-4-7" || (ju.AgentOptions["model"] != nil && ju.AgentOptions["model"] != "claude-opus-4-7") {
		t.Fatalf("written model: provider %+v, agent options %v", ju.Provider, ju.AgentOptions)
	}

	req.Roles[0].Provider = &WizardProvider{Vendor: "custom", BaseURL: srv.URL + "/v1", APIKey: "sk-test", Model: "Gemini 9"}
	if res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req); res.OK || !strings.Contains(res.Error, "claude-opus-4-7") {
		t.Fatalf("unmatched display name must fail naming the IDs: %+v", res)
	}
}
