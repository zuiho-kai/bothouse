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
		{"500 with 10003 body", withBody(500, discordgo.ErrCodeUnknownChannel), false},
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

// Task facts: an unrecoverable refusal (incl. 50083) is also undeliverable,
// so another account's refused fact gets the creator's note.
func TestPublishTaskFactUnrecoverable(t *testing.T) {
	for _, tc := range []struct {
		status, code         int
		undeliverable, unrec bool
	}{
		{404, discordgo.ErrCodeUnknownChannel, true, true},
		{403, discordgo.ErrCodeMissingPermissions, true, true},
		{400, discordgo.ErrCodePerformedOperationOnArchivedThread, true, true},
		{500, discordgo.ErrCodeUnknownChannel, false, false},
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

// repostREST: the card "old" was deleted by hand (PATCH → 10008); a new POST
// succeeds unless postCode is set.
type repostREST struct {
	posts, patches int
	postCode       int
}

func (r *repostREST) RoundTrip(req *http.Request) (*http.Response, error) {
	reply := func(status int, body any) (*http.Response, error) {
		b, _ := json.Marshal(body)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(b))), Request: req}, nil
	}
	switch {
	case req.Method == "GET" && strings.HasSuffix(req.URL.Path, "/messages"):
		return reply(200, []any{})
	case req.Method == "POST" && strings.HasSuffix(req.URL.Path, "/messages"):
		r.posts++
		if r.postCode != 0 {
			return reply(404, map[string]any{"code": r.postCode, "message": "x"})
		}
		return reply(200, &discordgo.Message{ID: "new", ChannelID: "room"})
	case req.Method == "PATCH" && strings.HasSuffix(req.URL.Path, "/messages/old"):
		r.patches++
		return reply(404, map[string]any{"code": discordgo.ErrCodeUnknownMessage, "message": "Unknown Message"})
	case req.Method == "PATCH":
		r.patches++
		return reply(200, &discordgo.Message{ID: "new", ChannelID: "room"})
	case req.Method == "GET":
		return reply(200, &discordgo.Channel{ID: "room", GuildID: "g", Type: discordgo.ChannelTypeGuildText})
	}
	return nil, errors.New("unexpected " + req.Method + " " + req.URL.Path)
}

// A card the user deleted (edit → 10008) is posted again, keeping its thread;
// if the repost is refused for good, the delivery is unrecoverable.
func TestEnsureTaskCardRepostsDeletedCard(t *testing.T) {
	newP := func(tr *repostREST) *Platform {
		session, _ := discordgo.New("Bot fixture")
		session.Client = &http.Client{Transport: tr}
		session.MaxRestRetries = 0
		return &Platform{session: session, botID: "bot"}
	}
	tr := &repostREST{}
	task := &core.Task{ID: "task-del", Title: "t", ChannelID: "room", MessageID: "old", ThreadID: "thread", CardURL: "https://discord.com/channels/g/room/old", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := newP(tr).EnsureTaskCard(context.Background(), task, core.LangEnglish); err != nil {
		t.Fatal(err)
	}
	if task.MessageID != "new" || task.ThreadID != "thread" || task.CardURL != "https://discord.com/channels/g/room/new" || tr.posts != 1 {
		t.Fatalf("not reposted: %+v posts=%d", task, tr.posts)
	}
	tr = &repostREST{postCode: discordgo.ErrCodeUnknownChannel}
	task = &core.Task{ID: "task-del", Title: "t", ChannelID: "room", MessageID: "old", ThreadID: "thread", CardURL: "x", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := newP(tr).EnsureTaskCard(context.Background(), task, core.LangEnglish); !errors.Is(err, core.ErrDeliveryUnrecoverable) || tr.posts != 1 {
		t.Fatalf("repost refused: err=%v posts=%d", err, tr.posts)
	}
}
