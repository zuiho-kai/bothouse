package cloudweb

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

func TestLocalDSHConnectionFollowsHostRestart(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONEST_COLLAB_DATA", dir)
	p := mustNew(t, map[string]any{
		"cc_project": "relay", core.LocalDSHRoomOption: int64(2), "dsh_member_name": "QA Relay",
	})
	ws := p.tp.(*wsTransport)
	// Keep both listeners reserved so the replacement host gets a different port.
	for i, token := range []string{"first-test-token", "second-test-token"} {
		history := fmt.Sprintf("history from host %d", i+1)
		delivered := make(chan map[string]any, 1)
		host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+token {
				t.Error("wrong gateway credential")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			switch r.URL.Path {
			case defaultWSPath:
				q := r.URL.Query()
				if q.Get("room") != "2" || q.Get("bot") != "relay" || q.Get("name") != "QA Relay" || q.Has("token") {
					t.Errorf("unexpected registration query: %v", q)
				}
				upgrader := websocket.Upgrader{}
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.Close()
				var register wireRegister
				if err := conn.ReadJSON(&register); err != nil || register.Project != "relay" {
					t.Errorf("register = %#v, error = %v", register, err)
					return
				}
				if err := conn.WriteJSON(map[string]any{"type": "register_ack", "ok": true}); err != nil {
					t.Error(err)
					return
				}
				var frame map[string]any
				if err := conn.ReadJSON(&frame); err != nil {
					t.Error(err)
					return
				}
				delivered <- frame
			case "/api/rooms/2/messages":
				_, _ = fmt.Fprintf(w, `{"messages":[{"id":12,"author_kind":"user","text":%q}]}`, history)
			default:
				http.NotFound(w, r)
			}
		}))
		t.Cleanup(host.Close)
		record, err := json.Marshal(map[string]any{
			"pid": os.Getpid(), "local": map[string]string{"origin": host.URL, "token": "test-owner-token"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "collab.owner.json"), record, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "bot-token"), []byte(token), 0o600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		connected := false
		ws.onConnected = func() {
			defer cancel()
			connected = true
			reply, err := p.ReconstructReplyCtx("cloud_web:room-2")
			if err != nil {
				t.Error(err)
				return
			}
			if err := p.Send(ctx, reply, "@Reviewer ready for QA"); err != nil {
				t.Error(err)
			}
		}
		err = ws.connectOnce(ctx)
		cancel()
		if !connected || err != nil {
			t.Fatalf("connection to %s: connected=%v error=%v", host.URL, connected, err)
		}
		select {
		case frame := <-delivered:
			if frame["reply_ctx"] != "room-2" || frame["content"] != "@Reviewer ready for QA" {
				t.Fatalf("message to DSH = %#v", frame)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("DSH host did not receive the message")
		}
		msgs, err := p.ChannelHistory("room-2", "", 10)
		if err != nil || len(msgs) != 1 || msgs[0].Content != history {
			t.Fatalf("history from %s: messages=%+v error=%v", host.URL, msgs, err)
		}
	}
}
