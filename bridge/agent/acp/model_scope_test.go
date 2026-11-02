package acp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestScopedModelACPProcess(t *testing.T) {
	path := os.Getenv("ACP_SCOPED_MODEL_RECORD")
	if path == "" {
		t.Skip("helper process")
	}
	dec, enc := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
	for {
		var req struct {
			ID     json.RawMessage
			Method string
			Params map[string]any
		}
		if err := dec.Decode(&req); err != nil {
			os.Exit(0)
		}
		if len(req.ID) == 0 {
			continue
		}
		result := map[string]any{}
		switch req.Method {
		case "initialize":
			result["protocolVersion"] = 1
			result["agentCapabilities"] = map[string]any{}
		case "session/new":
			result["sessionId"] = "scoped-session"
			result["models"] = map[string]any{"currentModelId": "astra", "availableModels": []any{map[string]any{"modelId": "astra"}, map[string]any{"modelId": `["provider","sol"]`}}}
			result["configOptions"] = []any{map[string]any{"id": "reasoning_effort", "category": "thought_level", "currentValue": "medium", "options": []any{map[string]any{"value": "high"}, map[string]any{"value": "medium"}}}}
		case "session/set_model", "session/set_config_option":
			b, _ := json.Marshal(req.Params)
			f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
			if err != nil {
				os.Exit(2)
			}
			_, _ = f.Write(append(b, '\n'))
			_ = f.Close()
		}
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
}

func TestSessionModelContextUsesACPSelectionRequests(t *testing.T) {
	record := filepath.Join(t.TempDir(), "requests.jsonl")
	a := &Agent{cmd: os.Args[0], args: []string{"-test.run=^TestScopedModelACPProcess$"}, workDir: t.TempDir(), model: "astra", effort: "medium", extraEnv: []string{"ACP_SCOPED_MODEL_RECORD=" + record}}
	for _, settings := range []core.SessionSettings{{Model: `["provider","sol"]`, ReasoningEffort: "high"}, {}} {
		s, err := a.StartSession(core.WithSessionSettings(context.Background(), settings), "")
		if err != nil {
			t.Fatal(err)
		}
		_ = s.Close()
	}
	b, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	wants := []struct{ field, value string }{{"modelId", `["provider","sol"]`}, {"value", "high"}, {"modelId", "astra"}, {"value", "medium"}}
	if len(lines) != len(wants) {
		t.Fatalf("selection requests = %s", b)
	}
	for i, want := range wants {
		var params map[string]any
		if err := json.Unmarshal([]byte(lines[i]), &params); err != nil {
			t.Fatal(err)
		}
		if params[want.field] != want.value {
			t.Fatalf("request %d = %v, want %s", i, params, want.value)
		}
	}
	if a.GetModel() != "astra" || a.GetReasoningEffort() != "medium" {
		t.Fatal("changed shared defaults")
	}
}
