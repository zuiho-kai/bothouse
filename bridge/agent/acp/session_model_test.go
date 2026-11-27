package acp

import (
	"encoding/json"
	"testing"
)

// #2040: a per-conversation /model switch is applied to its session only, and the reply footer
// asks the session before the agent. A session that could not say what it runs left the footer
// on the agent's default model.
func TestSessionReportsTheModelItRuns(t *testing.T) {
	s, responses, requests := newTestSession(t, nil)
	var advertised []acpConfigOption
	if err := json.Unmarshal([]byte(`[
		{"id":"model","category":"model","currentValue":"default-model","options":[{"value":"default-model"},{"value":"fast-model"}]},
		{"id":"thought","category":"thought_level","currentValue":"high","options":[{"value":"high"},{"value":"low"}]}]`), &advertised); err != nil {
		t.Fatal(err)
	}
	s.absorbModelInfo(nil, advertised)
	if s.GetModel() != "default-model" || s.GetReasoningEffort() != "high" {
		t.Fatalf("after handshake: model %q effort %q", s.GetModel(), s.GetReasoningEffort())
	}

	go func() {
		var req struct {
			ID     json.RawMessage
			Method string
			Params struct{ ConfigID, Value string }
		}
		if json.NewDecoder(requests).Decode(&req) != nil || req.Method != "session/set_config_option" || req.Params.Value != "fast-model" {
			return
		}
		_ = json.NewEncoder(responses).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"configOptions": []any{
			map[string]any{"id": "model", "category": "model", "currentValue": "fast-model"},
			map[string]any{"id": "thought", "category": "thought_level", "currentValue": "low"},
		}}})
	}()
	s.applyModel("fast-model")
	if s.GetModel() != "fast-model" {
		t.Fatalf("after the switch the session reports %q, want fast-model", s.GetModel())
	}
	if s.GetReasoningEffort() != "low" {
		t.Fatalf("effort that came with the new model = %q, want low", s.GetReasoningEffort())
	}

	// The server changed it on its own (one of its commands, another client).
	s.onNotification("session/update", json.RawMessage(`{"sessionId":"test-session-id","update":{"sessionUpdate":"config_option_update",
		"configOptions":[{"id":"mode","currentValue":"plan"},{"id":"model","category":"model","currentValue":"other-model"}]}}`))
	if s.GetModel() != "other-model" || s.GetReasoningEffort() != "low" {
		t.Fatalf("after config_option_update: model %q effort %q", s.GetModel(), s.GetReasoningEffort())
	}
}

// session/set_model (Cursor, Grok) answers without the value: the session keeps what it asked for.
func TestSessionReportsModelSetWithSetModel(t *testing.T) {
	s, responses, requests := newTestSession(t, nil)
	s.absorbModelInfo(&acpModelsBlock{CurrentModelID: "a", AvailableModels: []struct {
		ModelID     string `json:"modelId"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}{{ModelID: "a"}, {ModelID: "b"}}}, nil)
	go func() {
		var req inputRPCRequest
		if json.NewDecoder(requests).Decode(&req) != nil || req.Method != "session/set_model" {
			return
		}
		_ = json.NewEncoder(responses).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{}})
	}()
	s.applyModel("b")
	if s.GetModel() != "b" {
		t.Fatalf("session reports %q, want b", s.GetModel())
	}
}

// #2071: DSH advertises a model route as ["provider","model"]. The catalog id is the model id,
// and the opaque pair has to go back on session/set_config_option.
func TestSessionSendsOpaqueModelRouteForCatalogID(t *testing.T) {
	s, responses, requests := newTestSession(t, nil)
	var advertised []acpConfigOption
	if err := json.Unmarshal([]byte(`[{"id":"model","category":"model",
	 "currentValue":"[\"deepseek-official\",\"deepseek-v4.1-flash\"]",
	 "options":[{"group":"deepseek-official","name":"DeepSeek","options":[{"value":"[\"deepseek-official\",\"deepseek-v4.1-flash\"]","name":"DeepSeek V4.1 Flash"}]}]}]`), &advertised); err != nil {
		t.Fatal(err)
	}
	s.absorbModelInfo(nil, advertised)
	if s.GetModel() != "deepseek-v4.1-flash" {
		t.Fatalf("handshake reports %q, want the model id", s.GetModel())
	}
	got := make(chan string, 1)
	go func() {
		var req struct {
			ID     json.RawMessage
			Method string
			Params struct{ ConfigID, Value string }
		}
		if json.NewDecoder(requests).Decode(&req) != nil || req.Method != "session/set_config_option" {
			got <- ""
			return
		}
		got <- req.Params.Value
		_ = json.NewEncoder(responses).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"configOptions": []any{
			map[string]any{"id": "model", "category": "model", "currentValue": `["deepseek-official","deepseek-v4.1-flash"]`},
		}}})
	}()
	s.applyModel("deepseek-v4.1-flash")
	if v := <-got; v != `["deepseek-official","deepseek-v4.1-flash"]` {
		t.Fatalf("set_config_option value = %q, want the advertised route", v)
	}
	if s.GetModel() != "deepseek-v4.1-flash" {
		t.Fatalf("after the switch the session reports %q", s.GetModel())
	}
}
