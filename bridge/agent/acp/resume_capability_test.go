package acp

import (
	"encoding/json"
	"testing"
)

func TestResumeCapability_PreservesBindingWithoutLoadSession(t *testing.T) {
	for _, strict := range []bool{false, true} {
		for _, result := range []any{map[string]any{}, map[string]any{"sessionId": "wrong"}, nil} {
			s, w, r := newTestSession(t, nil)
			s.strictResume = strict
			methods := make(chan []string, 1)
			go func() {
				dec, enc := json.NewDecoder(r), json.NewEncoder(w)
				var seen []string
				defer func() { methods <- seen }()
				for {
					var req inputRPCRequest
					if dec.Decode(&req) != nil {
						return
					}
					seen = append(seen, req.Method)
					var response any
					switch req.Method {
					case "initialize":
						response = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"sessionCapabilities": map[string]any{"resume": map[string]any{}}}}
					case "session/resume":
						response = result
					case "session/new":
						response = map[string]any{"sessionId": "unwanted"}
					default:
						response = map[string]any{}
					}
					_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": response})
				}
			}()
			err := s.handshake("test-session-id", "")
			_ = r.Close()
			seen := <-methods
			good := result != nil && len(result.(map[string]any)) == 0
			if (err == nil) != good {
				t.Errorf("strict=%v: success=%v want=%v", strict, err == nil, good)
			}
			for _, method := range seen {
				if method == "session/new" {
					t.Error("replaced original session")
				}
			}
			if good && s.CurrentSessionID() != "test-session-id" {
				t.Error("binding changed")
			}
		}
	}
}
