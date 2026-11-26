package discord

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// Regression of #2232: with long /model content (a 170-model list beyond Discord's 2000-char
// limit) the text is already delivered in chunks before the buttons; delivering the buttons
// must neither repeat the text nor cause it to be sent again.

type buttonReqCapture struct {
	payloads []map[string]any
}

func captureButtonServer(t *testing.T, failComponents bool) (*httptest.Server, *buttonReqCapture) {
	t.Helper()
	cap := &buttonReqCapture{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			payload = map[string]any{}
		}
		cap.payloads = append(cap.payloads, payload)
		_, hasComponents := payload["components"].([]any)
		if failComponents && hasComponents {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = fmt.Fprint(w, `{"message":"Invalid Form Body"}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"msg-1","channel_id":"ch-1"}`)
	}))
	t.Cleanup(server.Close)
	return server, cap
}

func longModelList() string {
	// 来源：用户现场真实场景，/model 的 170 行编号列表，远超 Discord 单条 2000 字上限。
	var sb strings.Builder
	for i := 1; i <= 170; i++ {
		sb.WriteString(fmt.Sprintf("  %d. model-number-%d — some model description\n", i, i))
	}
	return sb.String()
}

func countMarker(cap *buttonReqCapture, marker string) int {
	total := 0
	for _, p := range cap.payloads {
		if c, ok := p["content"].(string); ok {
			total += strings.Count(c, marker)
		}
	}
	return total
}

func testButtonInteraction() *discordgo.Interaction {
	return &discordgo.Interaction{AppID: "app-1", Token: "token-1"}
}

func TestSendWithButtons_LongListNotDuplicated(t *testing.T) {
	server, cap := captureButtonServer(t, false)

	p := &Platform{session: newTestDiscordSession(t, server)}
	rc := &interactionReplyCtx{interaction: testButtonInteraction()}
	content := longModelList()
	err := p.SendWithButtons(context.Background(), rc, content, [][]core.ButtonOption{{
		{Text: "model 1", Data: "cmd:/model switch 1"},
		{Text: "model 2", Data: "cmd:/model switch 2"},
	}})
	if err != nil {
		t.Fatalf("SendWithButtons() error = %v", err)
	}

	// The final list line must appear exactly once across everything sent: before the fix the
	// button followup repeated it and the caller's plain-text fallback sent it yet again.
	if got := countMarker(cap, "170. model-number-170"); got != 1 {
		t.Fatalf("final list line appears %d times across payloads, want exactly 1", got)
	}

	// The message carrying the buttons must not repeat the list text.
	for _, p := range cap.payloads {
		components, hasComponents := p["components"].([]any)
		if !hasComponents || len(components) == 0 {
			continue
		}
		if c, _ := p["content"].(string); strings.Contains(c, "model-number") {
			t.Fatalf("button message repeats list content (len=%d), want buttons only", len(c))
		}
	}
}

func TestSendWithButtons_ButtonFailureDoesNotResendText(t *testing.T) {
	server, cap := captureButtonServer(t, true)

	p := &Platform{session: newTestDiscordSession(t, server)}
	rc := &interactionReplyCtx{interaction: testButtonInteraction()}
	content := longModelList()
	// Even if the button followup fails, the text is already delivered: the operation must not
	// report an error, because the caller would resend the full text a second time.
	err := p.SendWithButtons(context.Background(), rc, content, [][]core.ButtonOption{{
		{Text: "model 1", Data: "cmd:/model switch 1"},
	}})
	if err != nil {
		t.Fatalf("SendWithButtons() error = %v, want nil (content already delivered, buttons degrade)", err)
	}
	if got := countMarker(cap, "170. model-number-170"); got != 1 {
		t.Fatalf("final list line appears %d times across payloads, want exactly 1", got)
	}
}
