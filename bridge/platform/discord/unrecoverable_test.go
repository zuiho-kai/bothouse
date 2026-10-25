package discord

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

func TestDiscordUnrecoverableClassification(t *testing.T) {
	withBody := func(status, code int) error {
		return &discordgo.RESTError{Response: &http.Response{StatusCode: status}, Message: &discordgo.APIErrorMessage{Code: code}}
	}
	for _, tc := range []struct {
		name string
		err  error
		want bool
	}{
		{"10003 unknown channel", withBody(404, discordgo.ErrCodeUnknownChannel), true},
		{"10008 unknown message", withBody(404, discordgo.ErrCodeUnknownMessage), true},
		{"50001 missing access", withBody(403, discordgo.ErrCodeMissingAccess), true},
		{"50013 missing permissions", withBody(403, discordgo.ErrCodeMissingPermissions), true},
		{"50083 archived thread", withBody(400, discordgo.ErrCodePerformedOperationOnArchivedThread), true},
		{"403 with body", withBody(403, 0), true},
		{"404 with body", withBody(404, 0), true},
		{"bare 403", &discordgo.RESTError{Response: &http.Response{StatusCode: 403}}, false},
		{"bare 404", &discordgo.RESTError{Response: &http.Response{StatusCode: 404}}, false},
		{"429", withBody(429, 0), false},
		{"500", withBody(500, 0), false},
		{"network", errors.New("dial tcp: i/o timeout"), false},
		{"nil", nil, false},
	} {
		if got := discordUnrecoverable(tc.err); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
		if got := errors.Is(unrecoverableErr(tc.err), core.ErrDeliveryUnrecoverable); got != tc.want {
			t.Errorf("%s: wrapped %v want %v", tc.name, got, tc.want)
		}
	}
	if !errors.Is(core.ErrBoardUnremovable, core.ErrDeliveryUnrecoverable) {
		t.Fatal("ErrBoardUnremovable no longer matches ErrDeliveryUnrecoverable")
	}
}

// statusREST answers every request with one HTTP status and Discord error code
// (code 0 = no JSON error body), counting requests.
type statusREST struct {
	status, code int
	calls        int
}

func (r *statusREST) RoundTrip(req *http.Request) (*http.Response, error) {
	r.calls++
	body := "<html>bad gateway</html>"
	h := http.Header{"Content-Type": []string{"text/html"}}
	if r.code != 0 {
		b, _ := json.Marshal(map[string]any{"code": r.code, "message": "x"})
		body, h = string(b), http.Header{"Content-Type": []string{"application/json"}}
	}
	return &http.Response{StatusCode: r.status, Header: h, Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
}

func statusPlatform(status, code int) (*Platform, *statusREST) {
	tr := &statusREST{status: status, code: code}
	session, _ := discordgo.New("Bot fixture")
	session.Client = &http.Client{Transport: tr}
	session.MaxRestRetries = 0
	return &Platform{session: session, botID: "bot"}, tr
}

// Public progress card in a deleted channel: unrecoverable; a 502 is not.
func TestEnsureTaskCardDeletedChannelUnrecoverable(t *testing.T) {
	for _, tc := range []struct {
		status, code int
		want         bool
	}{{404, discordgo.ErrCodeUnknownChannel, true}, {403, discordgo.ErrCodeMissingAccess, true}, {502, 0, false}} {
		p, _ := statusPlatform(tc.status, tc.code)
		task := &core.Task{ID: "task-gone", Title: "t", ChannelID: "room", CreatedAt: time.Now(), UpdatedAt: time.Now()}
		err := p.EnsureTaskCard(context.Background(), task, core.LangEnglish)
		if err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) != tc.want {
			t.Fatalf("status %d code %d: err=%v want unrecoverable=%v", tc.status, tc.code, err, tc.want)
		}
	}
}

// Task facts: a refusal with Discord's body is unrecoverable and still
// undeliverable (so another account's fact is reposted by the creator).
func TestPublishTaskFactUnrecoverable(t *testing.T) {
	for _, tc := range []struct {
		status, code         int
		undeliverable, unrec bool
	}{
		{404, discordgo.ErrCodeUnknownChannel, true, true},
		{403, discordgo.ErrCodeMissingPermissions, true, true},
		{500, discordgo.ErrCodeUnknownChannel, false, true},
		{502, 0, false, false},
	} {
		p, _ := statusPlatform(tc.status, tc.code)
		task := &core.Task{ID: "task-gone", ThreadID: "thread", ChannelID: "room"}
		err := p.PublishTaskFact(context.Background(), task, core.TaskEvent{ID: "task-gone:2", Summary: "x", Timestamp: time.Now(), IsKeyFact: true}, core.LangEnglish)
		if err == nil || errors.Is(err, core.ErrTaskFactUndeliverable) != tc.undeliverable || errors.Is(err, core.ErrDeliveryUnrecoverable) != tc.unrec {
			t.Fatalf("status %d code %d: err=%v", tc.status, tc.code, err)
		}
	}
}

// Channel board: a deleted channel is unrecoverable on find, post and edit;
// an edit of a deleted message stays ErrChannelBoardGone (post a new board).
func TestChannelBoardUnrecoverable(t *testing.T) {
	payload := core.BuildChannelBoardPayload(core.ChannelBoardPayload{})
	p, _ := statusPlatform(404, discordgo.ErrCodeUnknownChannel)
	if _, _, err := p.FindChannelBoard(context.Background(), "c1"); !errors.Is(err, core.ErrDeliveryUnrecoverable) {
		t.Fatalf("find: %v", err)
	}
	if _, err := p.PostChannelBoard(context.Background(), "c1", payload); !errors.Is(err, core.ErrDeliveryUnrecoverable) {
		t.Fatalf("post: %v", err)
	}
	if err := p.EditChannelBoard(context.Background(), "c1", "m1", payload); !errors.Is(err, core.ErrDeliveryUnrecoverable) {
		t.Fatalf("edit: %v", err)
	}
	p, _ = statusPlatform(404, discordgo.ErrCodeUnknownMessage)
	if err := p.EditChannelBoard(context.Background(), "c1", "m1", payload); !errors.Is(err, core.ErrChannelBoardGone) || errors.Is(err, core.ErrDeliveryUnrecoverable) {
		t.Fatalf("edit of deleted message: %v", err)
	}
	p, _ = statusPlatform(503, 0)
	if _, err := p.PostChannelBoard(context.Background(), "c1", payload); err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) {
		t.Fatalf("503 post: %v", err)
	}
}
