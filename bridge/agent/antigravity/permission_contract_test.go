package antigravity

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/agent/antigravityhook"
	"github.com/chenhg5/cc-connect/core"
)

// Test the real request handler in memory. The existing integration test
// separately checks the TCP listener and hook configuration overlay.
func TestAgyPermissionBridge_DecisionContract(t *testing.T) {
	for _, tc := range []struct {
		name, token, behavior, decision string
	}{
		{"approved", "test-token", "allow", "auto_approve"},
		{"denied", "test-token", "deny", "deny"},
		{"unauthenticated", "wrong-token", "", "deny"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			events := make(chan core.Event, 1)
			b := &agyPermissionBridge{
				ctx: ctx, token: "test-token",
				events:  events,
				pending: make(map[string]chan core.PermissionResult),
			}
			client, server := net.Pipe()
			b.wg.Add(1)
			go b.handleConnection(server)
			t.Cleanup(func() {
				cancel()
				_ = client.Close()
				b.wg.Wait()
			})
			if err := client.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
				t.Fatal(err)
			}
			input, err := json.Marshal(map[string]any{"toolCall": map[string]any{
				"name": "run_command", "args": map[string]string{"CommandLine": "true"},
			}})
			if err != nil {
				t.Fatal(err)
			}
			request := antigravityhook.BridgeRequest{Token: tc.token, HookInput: input}
			if err := json.NewEncoder(client).Encode(request); err != nil {
				t.Fatal(err)
			}
			if tc.behavior != "" {
				select {
				case event := <-events:
					if event.Type != core.EventPermissionRequest || event.ToolName != "run_command" {
						t.Fatalf("unexpected event: %+v", event)
					}
					if err := b.RespondPermission(event.RequestID, core.PermissionResult{Behavior: tc.behavior, Message: "test decision"}); err != nil {
						t.Fatal(err)
					}
				case <-time.After(3 * time.Second):
					t.Fatal("permission request did not reach the bridge")
				}
			}
			var response antigravityhook.BridgeResponse
			if err := json.NewDecoder(client).Decode(&response); err != nil {
				t.Fatal(err)
			}
			if response.Decision != tc.decision {
				t.Fatalf("decision = %q, want %q", response.Decision, tc.decision)
			}
			if tc.behavior == "deny" && response.Reason != "test decision" {
				t.Fatalf("denial reason lost: %+v", response)
			}
			if tc.behavior == "" {
				select {
				case event := <-events:
					t.Fatalf("unauthenticated request reached approval: %+v", event)
				default:
				}
			}
		})
	}
}
