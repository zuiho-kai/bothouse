package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProjectTextTaskUsesOnlyActiveTextProvider(t *testing.T) {
	calls := 0
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body pcReq
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer synthetic" || body.Model != "fixture-role" || len(body.Tools) != 0 || body.ToolChoice != "none" || len(body.Messages) != 2 {
			t.Error("unexpected provider request")
		}
		switch body.Messages[1].Content {
		case "name a club":
			w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"High Tide"}}]}`))
		case "external":
			w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"claimed done","tool_calls":[{"type":"function","function":{"name":"send"}}]}}]}`))
		case "redirect":
			http.Redirect(w, r, "/other-endpoint", http.StatusTemporaryRedirect)
		default:
			t.Error("unexpected input")
		}
	}))
	defer model.Close()
	agent := &stubModelModeAgent{active: "fixture", providers: []ProviderConfig{{Name: "fixture", APIFormat: APIFormatOpenAIChat, BaseURL: model.URL + "/v1", APIKey: "synthetic", Model: "fixture-role"}}}
	engine := NewEngine("test-role", agent, nil, "", LangEnglish)
	mgmt := NewManagementServer(0, "test-token", nil)
	mgmt.RegisterEngine("test-role", engine)
	req := func(method, body, token string, status int, want string) {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1/projects/test-role/text-task", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		mgmt.wrap(mgmt.handleProjectRoutes)(w, r)
		if w.Code != status || !strings.Contains(w.Body.String(), want) {
			t.Errorf("got %d %s", w.Code, w.Body.String())
		}
	}
	req("POST", `{"text":"unauthorized"}`, "wrong", 401, "")
	req("GET", "", "test-token", 200, `"available":true`)
	req("POST", `{"text":"name a club"}`, "test-token", 200, "High Tide")
	req("POST", `{"text":"external"}`, "test-token", 200, `"defer":"external"`)
	req("POST", `{"text":"redirect"}`, "test-token", 200, "receipt_unknown")
	engine.SetPaused(true)
	req("POST", `{"text":"paused"}`, "test-token", 200, `"defer":"backend"`)
	engine.SetPaused(false)
	agent.active = ""
	req("POST", `{"text":"no selected provider"}`, "test-token", 200, `"defer":"backend"`)
	if calls != 3 {
		t.Fatalf("got %d provider calls, want 3", calls)
	}
}
