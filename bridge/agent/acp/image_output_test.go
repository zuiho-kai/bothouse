package acp

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// #1749: image content belongs to the successful prompt's result, never to
// the next turn or a cancelled/invalid result. Payloads are synthetic.
func TestACPImageOutput(t *testing.T) {
	data := []byte("synthetic image")
	encoded := base64.StdEncoding.EncodeToString(data)
	for _, tc := range []struct {
		name, mime, data, ending string
		ok                       bool
	}{
		{"image", "image/png", encoded, "end_turn", true},
		{"invalid-base64", "image/png", "!invalid!", "end_turn", false},
		{"unsupported-mime", "image/svg+xml", encoded, "end_turn", false},
		{"empty", "image/png", "", "end_turn", false},
		{"cancelled", "image/png", encoded, "cancelled", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, responses, requests := newTestSession(t, nil)
			go func() {
				dec, enc := json.NewDecoder(requests), json.NewEncoder(responses)
				for turn := 0; turn < 2; turn++ {
					var req inputRPCRequest
					if dec.Decode(&req) != nil {
						return
					}
					ending := "end_turn"
					if turn == 0 {
						ending = tc.ending
						_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
							"sessionId": "test-session-id", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{
								"type": "image", "mimeType": tc.mime, "data": tc.data,
							}},
						}})
					} else {
						_ = enc.Encode(inputUpdate("test-session-id", "next reply"))
					}
					_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"stopReason": ending}})
				}
			}()
			for turn := 0; turn < 2; turn++ {
				if err := s.Send("image", "m", nil, nil); err != nil {
					t.Fatal(err)
				}
				results, failures, images := 0, 0, 0
				for len(s.events) > 0 {
					event := <-s.events
					images += len(event.Images)
					for _, img := range event.Images {
						if img.MimeType != "image/png" || string(img.Data) != string(data) {
							t.Fatalf("decoded image changed: %+v", img)
						}
					}
					if event.Type == core.EventResult {
						results++
					}
					if event.Type == core.EventError {
						failures++
					}
				}
				wantOK := tc.ok || turn == 1
				wantImages := 0
				if tc.ok && turn == 0 {
					wantImages = 1
				}
				if results+failures != 1 || (results == 1) != wantOK || images != wantImages {
					t.Fatalf("turn=%d results=%d failures=%d images=%d; want success=%v images=%d", turn, results, failures, images, wantOK, wantImages)
				}
			}
		})
	}
}
