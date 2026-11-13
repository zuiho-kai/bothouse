package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type agentImagePlatform struct {
	stubPlatformEngine
	attempts int
	err      error
}

func (p *agentImagePlatform) SendImage(context.Context, any, ImageAttachment) error {
	p.attempts++
	return p.err
}

// #1749: a native image is a real delivery, including the same attachment
// switch as /send. An EOF after an attempted send cannot replay the prompt.
func TestAgentImageDelivery(t *testing.T) {
	for _, tc := range []struct {
		name     string
		disabled bool
		err      error
		caption  string
	}{
		{name: "image-only"},
		{name: "caption", caption: "image caption"},
		{name: "disabled", disabled: true},
		{name: "unknown-receipt", err: errors.New("unexpected EOF")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &agentImagePlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}, err: tc.err}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			e.SetDataDir(t.TempDir())
			e.SetReplyFooterEnabled(false)
			e.attachmentSendEnabled = !tc.disabled
			defer e.Stop()
			key := "test:image"
			session := e.sessions.GetOrCreateActive(key)
			as := newControllableSession("image-session")
			state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx"}
			e.interactiveStates[key] = state
			as.events <- Event{Type: EventResult, Done: true, Content: tc.caption, Images: []ImageAttachment{{MimeType: "image/png", Data: []byte("image")}}}
			e.processInteractiveEvents(state, session, e.sessions, key, "message", time.Now(), nil, nil, "ctx")
			wantAttempts := 1
			if tc.disabled {
				wantAttempts = 0
			}
			if p.attempts != wantAttempts {
				t.Fatalf("image attempts=%d, want %d", p.attempts, wantAttempts)
			}
			state.mu.Lock()
			retry, failed := state.capacityFailed, state.turnErrored
			state.mu.Unlock()
			if retry || failed != (tc.err != nil || tc.disabled) {
				t.Fatalf("retry=%v failed=%v after image delivery", retry, failed)
			}
			sent := strings.Join(p.getSent(), "\n")
			if tc.err == nil && !tc.disabled && sent != tc.caption {
				t.Fatalf("unexpected reply after image: %q, want %q", sent, tc.caption)
			}
			if (tc.err != nil || tc.disabled) && sent == "" {
				t.Fatal("image failure did not reach the user")
			}
		})
	}
}
