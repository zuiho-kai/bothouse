package discord

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/bwmarrin/discordgo"
)

type reactionRecorder struct {
	mu   sync.Mutex
	reqs []string // "METHOD emoji"
}

func (r *reactionRecorder) RoundTrip(req *http.Request) (*http.Response, error) {
	path := req.URL.EscapedPath()
	i := strings.Index(path, "/reactions/")
	if i >= 0 {
		rest := path[i+len("/reactions/"):]
		emoji, _ := url.PathUnescape(strings.SplitN(rest, "/", 2)[0])
		r.mu.Lock()
		r.reqs = append(r.reqs, req.Method+" "+emoji)
		r.mu.Unlock()
	}
	return &http.Response{StatusCode: http.StatusNoContent, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{}, Request: req}, nil
}

func testAckPlatform(t *testing.T, opts map[string]any) (*Platform, *reactionRecorder) {
	t.Helper()
	s, _ := discordgo.New("Bot x")
	rec := &reactionRecorder{}
	s.Client = &http.Client{Transport: rec}
	p := &Platform{session: s, acks: newAckReactions(opts)}
	return p, rec
}

func TestAckEmojiDefaultAndCustom(t *testing.T) {
	for _, tc := range []struct {
		opt  any
		want string
	}{{nil, "👀"}, {"  ", "👀"}, {"🐱", "🐱"}} {
		opts := map[string]any{}
		if tc.opt != nil {
			opts["ack_emoji"] = tc.opt
		}
		p, rec := testAckPlatform(t, opts)
		rc := replyContext{messageID: "m1", msgChannelID: "c1"}
		p.ReactReceived(rc)
		p.ReactTurnOutcome(rc, false)
		got := strings.Join(rec.reqs, ",")
		want := "PUT " + tc.want + ",PUT ✅,DELETE " + tc.want
		if got != want {
			t.Fatalf("ack_emoji=%v: got %q want %q", tc.opt, got, want)
		}
	}
}

func TestAckClearStaleUsesEmojiThatWasPutOn(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "discord_ack_pending_p.json")
	// m-old: written before ack_emoji existed (value = channel ID, emoji 👀).
	// m-new: written by a run whose ack_emoji was 🐱.
	if err := os.WriteFile(path, []byte(`{"m-old":"c1","m-new":{"c":"c2","e":"🐱"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	p, rec := testAckPlatform(t, map[string]any{"cc_data_dir": dir, "cc_project": "p", "ack_emoji": "🦊"})
	p.acks.clearStale(p.session)
	got := map[string]bool{}
	for _, r := range rec.reqs {
		got[r] = true
	}
	if len(rec.reqs) != 2 || !got["DELETE 👀"] || !got["DELETE 🐱"] {
		t.Fatalf("got %v, want DELETE 👀 and DELETE 🐱", rec.reqs)
	}
	if _, ok := p.acks.lookup("m-old"); ok {
		t.Fatal("stale entry still pending")
	}
}
