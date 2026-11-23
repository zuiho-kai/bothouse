package core

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestMgmtGeneralMessagesAndMembers(t *testing.T) {
	mgmt := NewManagementServer(0, "general-token", nil)
	handler := mgmt.buildHandler(http.NewServeMux())
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}
	const messagesPath = "/api/v1/general/messages"
	const membersPath = "/api/v1/general/members"
	const eventsPath = "/api/v1/general/events"
	for _, endpoint := range []string{messagesPath, membersPath, eventsPath} {
		if got := request(http.MethodGet, endpoint, "", ""); got.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated GET %s status = %d, want 401", endpoint, got.Code)
		}
	}
	if got := request(http.MethodGet, messagesPath, "general-token", ""); got.Code != http.StatusNotFound {
		t.Fatalf("unconfigured room status = %d, want 404", got.Code)
	}

	room, err := NewGeneralRoom(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mgmt.SetGeneralRoom(room)
	inbound := make(map[string][]Message)
	for _, member := range []GeneralRoomMember{{Project: "reviewer", DisplayName: "Reviewer"}, {Project: "planner", DisplayName: "Planner"}} {
		p := room.Platform(member.Project, member.DisplayName)
		if err := p.Start(func(_ Platform, msg *Message) {
			inbound[member.Project] = append(inbound[member.Project], *msg)
		}); err != nil {
			t.Fatal(err)
		}
	}
	members := request(http.MethodGet, membersPath, "general-token", "")
	var listed struct {
		Data struct {
			Members []GeneralRoomMember `json:"members"`
		} `json:"data"`
	}
	wantMembers := []GeneralRoomMember{{Project: "planner", DisplayName: "Planner"}, {Project: "reviewer", DisplayName: "Reviewer"}}
	if err := json.Unmarshal(members.Body.Bytes(), &listed); err != nil || members.Code != http.StatusOK ||
		!slices.Equal(listed.Data.Members, wantMembers) {
		t.Fatalf("members status=%d body=%s error=%v", members.Code, members.Body, err)
	}

	empty := request(http.MethodGet, messagesPath, "general-token", "")
	if empty.Code != http.StatusOK || !strings.Contains(empty.Body.String(), `"messages":[]`) {
		t.Fatalf("empty history status=%d body=%s", empty.Code, empty.Body)
	}
	if got := request(http.MethodPost, messagesPath, "", `{"text":"@reviewer denied"}`); got.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated post status = %d, want 401", got.Code)
	}
	for _, body := range []string{`{"text":" "}`, `{"text":"@reviewer impersonation","author_id":"reviewer"}`, `{"text":"one"} {}`} {
		if got := request(http.MethodPost, messagesPath, "general-token", body); got.Code != http.StatusBadRequest {
			t.Fatalf("invalid post %q status = %d, want 400", body, got.Code)
		}
	}
	if got := request(http.MethodGet, eventsPath+"?after=1", "general-token", ""); got.Code != http.StatusBadRequest {
		t.Fatalf("cursor past transcript status = %d, want 400", got.Code)
	}
	posted := request(http.MethodPost, messagesPath, "general-token", `{"text":"@reviewer check the rollout"}`)
	var result struct {
		Data GeneralMessage `json:"data"`
	}
	if err := json.Unmarshal(posted.Body.Bytes(), &result); err != nil || posted.Code != http.StatusCreated ||
		result.Data.ID != "1" || result.Data.AuthorID != "web-admin" || result.Data.Target != "reviewer" {
		t.Fatalf("post status=%d body=%s error=%v", posted.Code, posted.Body, err)
	}
	if len(inbound["reviewer"]) != 1 || len(inbound["planner"]) != 0 {
		t.Fatalf("post should only reach the reviewer: %v", inbound)
	}
	msg := inbound["reviewer"][0]
	if msg.UserID != "web-admin" || msg.SessionKey != GeneralSessionKey || !msg.Mentioned || msg.FromBot {
		t.Fatalf("unexpected inbox message: %+v", msg)
	}
	history := request(http.MethodGet, messagesPath, "general-token", "")
	if history.Code != http.StatusOK || !strings.Contains(history.Body.String(), result.Data.Text) {
		t.Fatalf("history status=%d body=%s", history.Code, history.Body)
	}
}

func TestMgmtGeneralEventsReplayAndReconnect(t *testing.T) {
	room, err := NewGeneralRoom(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mgmt := NewManagementServer(0, "general-token", nil)
	mgmt.SetGeneralRoom(room)
	server := httptest.NewServer(mgmt.buildHandler(http.NewServeMux()))
	defer server.Close()

	post := func(text string) {
		t.Helper()
		if err := room.PostUserMessage("web-admin", "Web Admin", text); err != nil {
			t.Fatal(err)
		}
	}
	connect := func(query, lastID string) (*bufio.Scanner, func()) {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/v1/general/events"+query, nil)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer general-token")
		req.Header.Set("Last-Event-ID", lastID)
		resp, err := server.Client().Do(req)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		closeStream := func() {
			cancel()
			resp.Body.Close()
		}
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "text/event-stream" {
			closeStream()
			t.Fatalf("stream status=%d type=%q", resp.StatusCode, resp.Header.Get("Content-Type"))
		}
		return bufio.NewScanner(resp.Body), closeStream
	}
	expect := func(stream *bufio.Scanner, id, text string) {
		t.Helper()
		lines := []string{"id: " + id, "event: message"}
		for _, want := range lines {
			if !stream.Scan() || stream.Text() != want {
				t.Fatalf("event line = %q, want %q (error %v)", stream.Text(), want, stream.Err())
			}
		}
		var message GeneralMessage
		if !stream.Scan() {
			t.Fatalf("missing event data: %v", stream.Err())
		}
		if data, ok := strings.CutPrefix(stream.Text(), "data: "); !ok ||
			json.Unmarshal([]byte(data), &message) != nil || message.ID != id || message.Text != text {
			t.Fatalf("unexpected event data: %q", stream.Text())
		}
		if !stream.Scan() || stream.Text() != "" {
			t.Fatalf("missing event separator: %q", stream.Text())
		}
	}

	post("previous message")
	post("posted since history fetch")
	stream, closeStream := connect("?after=1", "")
	defer closeStream()
	expect(stream, "2", "posted since history fetch")
	post("live message")
	expect(stream, "3", "live message")
	closeStream()

	post("posted during disconnect")
	reconnected, closeReconnect := connect("?after=1", "3")
	defer closeReconnect()
	expect(reconnected, "4", "posted during disconnect")
}
