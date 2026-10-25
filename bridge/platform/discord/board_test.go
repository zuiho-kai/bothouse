package discord

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

func TestBoardBeforeConnectionAndAfterStop(t *testing.T) {
	for _, stopped := range []bool{false, true} {
		for _, operation := range []string{"remove", "upsert"} {
			t.Run(fmt.Sprintf("stopped=%t/%s", stopped, operation), func(t *testing.T) {
				p := &Platform{}
				if stopped {
					if err := p.Stop(); err != nil {
						t.Fatal(err)
					}
				}
				var err error
				if operation == "remove" {
					err = p.RemoveBoard(context.Background(), "discord:123:456", "789")
				} else {
					_, err = p.UpsertBoard(context.Background(), "discord:123:456", "789", "status")
				}
				if err == nil || !strings.Contains(err.Error(), "not connected") {
					t.Fatalf("want retryable not-connected error, got %v", err)
				}
			})
		}
	}
}

// Exercise the real platform entry points and discordgo without network I/O.
type boardREST struct {
	calls atomic.Int64
}

func (r *boardREST) RoundTrip(req *http.Request) (*http.Response, error) {
	r.calls.Add(1)
	if req.URL.Path != "/api/v9/channels/123/messages/789" {
		return nil, fmt.Errorf("unexpected board request: %s %s", req.Method, req.URL.Path)
	}
	status, body := http.StatusOK, `{"id":"789","pinned":true}`
	switch req.Method {
	case http.MethodDelete:
		status, body = http.StatusNoContent, ""
	case http.MethodPatch:
	default:
		return nil, fmt.Errorf("unexpected board method: %s", req.Method)
	}
	return &http.Response{StatusCode: status, Header: make(http.Header),
		Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
}

func TestBoardRetryAfterConnection(t *testing.T) {
	p := &Platform{}
	ctx := context.Background()
	if err := p.RemoveBoard(ctx, "discord:123:456", "789"); err == nil {
		t.Fatal("disconnected removal must remain retryable")
	}
	if _, err := p.UpsertBoard(ctx, "discord:123:456", "789", "status"); err == nil {
		t.Fatal("disconnected update must remain retryable")
	}
	session, err := discordgo.New("Bot test")
	if err != nil {
		t.Fatal(err)
	}
	transport := &boardREST{}
	session.Client = &http.Client{Transport: transport}
	p.mu.Lock()
	p.session = session
	p.mu.Unlock()
	if err := p.RemoveBoard(ctx, "discord:123:456", "789"); err != nil {
		t.Fatal(err)
	}
	if id, err := p.UpsertBoard(ctx, "discord:123:456", "789", "status"); err != nil || id != "789" {
		t.Fatalf("connected update = (%q, %v)", id, err)
	}
	// Concurrent maintenance and shutdown must not race on p.session or panic.
	var workers sync.WaitGroup
	for range 2 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range 100 {
				err := p.RemoveBoard(ctx, "discord:123:456", "789")
				if err != nil && !strings.Contains(err.Error(), "not connected") {
					t.Errorf("remove during stop: %v", err)
				}
				_, err = p.UpsertBoard(ctx, "discord:123:456", "789", "status")
				if err != nil && !strings.Contains(err.Error(), "not connected") {
					t.Errorf("upsert during stop: %v", err)
				}
			}
		}()
	}
	if err := p.Stop(); err != nil {
		t.Fatal(err)
	}
	workers.Wait()
	calls := transport.calls.Load()
	if err := p.RemoveBoard(ctx, "discord:123:456", "789"); err == nil {
		t.Fatal("removal after stop must fail")
	}
	if _, err := p.UpsertBoard(ctx, "discord:123:456", "789", "status"); err == nil {
		t.Fatal("update after stop must fail")
	}
	if transport.calls.Load() != calls {
		t.Fatal("stopped platform must not issue REST requests")
	}
}

type stubBoardAPI struct {
	editErr  error
	edits    int
	sends    []*discordgo.MessageSend
	pins     []string
	deletes  []string
	delErr   error
	unpinned bool
	pinErr   error
}

func (s *stubBoardAPI) ChannelMessageDelete(_, messageID string, _ ...discordgo.RequestOption) error {
	s.deletes = append(s.deletes, messageID)
	return s.delErr
}

func (s *stubBoardAPI) ChannelMessageSendComplex(channelID string, data *discordgo.MessageSend, _ ...discordgo.RequestOption) (*discordgo.Message, error) {
	s.sends = append(s.sends, data)
	return &discordgo.Message{ID: "new", ChannelID: channelID}, nil
}

func (s *stubBoardAPI) ChannelMessageEditComplex(_ *discordgo.MessageEdit, _ ...discordgo.RequestOption) (*discordgo.Message, error) {
	s.edits++
	return &discordgo.Message{Pinned: !s.unpinned}, s.editErr
}

func (s *stubBoardAPI) ChannelMessagePin(_, messageID string, _ ...discordgo.RequestOption) error {
	s.pins = append(s.pins, messageID)
	return s.pinErr
}

func TestUpsertBoardEditsInPlace(t *testing.T) {
	api := &stubBoardAPI{}
	id, err := upsertBoard(api, "c1", "old", "**谁在干啥**\n**G哥**　🔧 预解码")
	if err != nil || id != "old" {
		t.Fatalf("upsert = (%q, %v)", id, err)
	}
	if api.edits != 1 || len(api.sends) != 0 || len(api.pins) != 0 {
		t.Fatalf("edits=%d sends=%d pins=%d, want an in-place edit only", api.edits, len(api.sends), len(api.pins))
	}
}

func TestUpsertBoardRepostsWhenGone(t *testing.T) {
	api := &stubBoardAPI{editErr: &discordgo.RESTError{Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeUnknownMessage}}}
	id, err := upsertBoard(api, "c1", "old", "**谁在干啥**\n**G哥**　💤 空闲")
	if err != nil || id != "new" {
		t.Fatalf("upsert = (%q, %v)", id, err)
	}
	if len(api.sends) != 1 || len(api.pins) != 1 || api.pins[0] != "new" {
		t.Fatalf("sends=%d pins=%v, want one new pinned board", len(api.sends), api.pins)
	}
	send := api.sends[0]
	if send.AllowedMentions == nil || len(send.AllowedMentions.Parse) != 0 {
		t.Fatal("board must not ping anyone")
	}
	if e := send.Embeds[0]; e.Title != "谁在干啥" || e.Description != "**G哥**　💤 空闲" {
		t.Fatalf("embed = %q / %q", e.Title, e.Description)
	}
}

func TestUpsertBoardFirstPost(t *testing.T) {
	api := &stubBoardAPI{}
	if id, err := upsertBoard(api, "c1", "", "**谁在干啥**"); err != nil || id != "new" || api.edits != 0 {
		t.Fatalf("upsert = (%q, %v), edits=%d", id, err, api.edits)
	}
}

func TestRemoveBoard(t *testing.T) {
	api := &stubBoardAPI{}
	if err := removeBoard(api, "c1", "m1"); err != nil || len(api.deletes) != 1 || api.deletes[0] != "m1" {
		t.Fatalf("remove = %v, deletes=%v", err, api.deletes)
	}
	api.delErr = &discordgo.RESTError{Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeUnknownMessage}}
	if err := removeBoard(api, "c1", "gone"); err != nil {
		t.Fatalf("already-deleted board should count as removed: %v", err)
	}
	api.delErr = errors.New("network")
	if err := removeBoard(api, "c1", "m2"); err == nil || errors.Is(err, core.ErrBoardUnremovable) {
		t.Fatalf("temporary failure must stay retryable: %v", err)
	}
	api.delErr = &discordgo.RESTError{Response: &http.Response{StatusCode: http.StatusInternalServerError},
		Message: &discordgo.APIErrorMessage{Code: 0}}
	if err := removeBoard(api, "c1", "m2"); err == nil || errors.Is(err, core.ErrBoardUnremovable) {
		t.Fatalf("server error must stay retryable: %v", err)
	}
	for _, rest := range []*discordgo.RESTError{
		{Response: &http.Response{StatusCode: http.StatusBadRequest}, Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodePerformedOperationOnArchivedThread}},
		{Response: &http.Response{StatusCode: http.StatusNotFound}, Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeUnknownChannel}},
		{Response: &http.Response{StatusCode: http.StatusForbidden}, Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeMissingAccess}},
		{Response: &http.Response{StatusCode: http.StatusForbidden}, Message: &discordgo.APIErrorMessage{Code: 0}},
	} {
		api.delErr = rest
		if err := removeBoard(api, "c1", "m3"); !errors.Is(err, core.ErrBoardUnremovable) {
			t.Fatalf("permanent failure %+v must be unremovable, got %v", rest.Message, err)
		}
	}
}

// The edit already shows the new content; a failing pin (permission, 50-pin
// limit) must not make the caller retry the same edit every tick forever.
func TestUpsertBoardEditSucceedsPinFails(t *testing.T) {
	api := &stubBoardAPI{unpinned: true, pinErr: errors.New("missing permissions")}
	id, err := upsertBoard(api, "c1", "old", "**谁在干啥**")
	if err != nil || id != "old" || api.edits != 1 || len(api.pins) != 1 {
		t.Fatalf("upsert = (%q, %v) edits=%d pins=%v, want saved edit despite pin error", id, err, api.edits, api.pins)
	}
}

type stubChatPost struct {
	sent []*discordgo.MessageSend
	err  error
}

func (s *stubChatPost) ChannelMessageSendComplex(_ string, data *discordgo.MessageSend, _ ...discordgo.RequestOption) (*discordgo.Message, error) {
	s.sent = append(s.sent, data)
	return &discordgo.Message{}, s.err
}

func TestPostToChatOutcome(t *testing.T) {
	lost := &stubChatPost{err: io.ErrUnexpectedEOF}
	if err := postToChat(context.Background(), lost, "c1", "<@42> x", "<@42>"); !errors.Is(err, core.ErrPostOutcomeUnknown) {
		t.Fatalf("lost reply must be outcome-unknown, got %v", err)
	}
	rejected := &stubChatPost{err: &discordgo.RESTError{Response: &http.Response{StatusCode: 403}}}
	if err := postToChat(context.Background(), rejected, "c1", "<@42> x", "<@42>"); err == nil || errors.Is(err, core.ErrPostOutcomeUnknown) {
		t.Fatalf("a 403 is a definite failure, got %v", err)
	}
}

func TestPostToChatPingsOnlyTarget(t *testing.T) {
	api := &stubChatPost{}
	if err := postToChat(context.Background(), api, "c1", "<@42> 【语音转达】主人：继续", "<@42>"); err != nil {
		t.Fatal(err)
	}
	m := api.sent[0].AllowedMentions
	if m == nil || len(m.Users) != 1 || m.Users[0] != "42" || len(m.Parse) != 0 {
		t.Fatalf("allowed mentions = %+v", m)
	}
	if err := postToChat(context.Background(), api, "c1", "x", "@everyone"); err == nil || len(api.sent) != 1 {
		t.Fatal("invalid mention must not post")
	}
}

// A 403/404 without a Discord JSON error body (e.g. an HTML page from a CDN)
// is not proof the board is gone for good, so it stays retryable.
func TestBoardBare403IsTemporary(t *testing.T) {
	for _, status := range []int{http.StatusForbidden, http.StatusNotFound} {
		bare := &discordgo.RESTError{Response: &http.Response{StatusCode: status}, ResponseBody: []byte("<html>")}
		api := &stubBoardAPI{delErr: bare, editErr: bare}
		if err := removeBoard(api, "c1", "m1"); err == nil || errors.Is(err, core.ErrBoardUnremovable) {
			t.Fatalf("delete %d without error body = %v, want temporary", status, err)
		}
		if _, err := upsertBoard(api, "c1", "m1", "**谁在干啥**"); err == nil || errors.Is(err, core.ErrBoardUnremovable) {
			t.Fatalf("edit %d without error body = %v, want temporary", status, err)
		}
		if len(api.sends) != 0 {
			t.Fatalf("edit %d failure posted a new board", status)
		}
	}
}

// An edit in an archived thread (or a deleted / inaccessible channel) can never
// succeed; it is reported as unremovable and no new board is posted, since
// posting would bump the archived thread.
func TestUpsertBoardEditUnrecoverable(t *testing.T) {
	for _, rest := range []*discordgo.RESTError{
		{Response: &http.Response{StatusCode: http.StatusBadRequest}, Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodePerformedOperationOnArchivedThread}},
		{Response: &http.Response{StatusCode: http.StatusNotFound}, Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeUnknownChannel}},
		{Response: &http.Response{StatusCode: http.StatusForbidden}, Message: &discordgo.APIErrorMessage{Code: discordgo.ErrCodeMissingAccess}},
	} {
		api := &stubBoardAPI{editErr: rest}
		id, err := upsertBoard(api, "c1", "old", "**谁在干啥**")
		if !errors.Is(err, core.ErrBoardUnremovable) || id != "old" {
			t.Fatalf("edit %+v = (%q, %v), want unremovable", rest.Message, id, err)
		}
		if len(api.sends) != 0 || len(api.pins) != 0 {
			t.Fatalf("edit %+v: sends=%d pins=%v, want nothing posted", rest.Message, len(api.sends), api.pins)
		}
	}
}
