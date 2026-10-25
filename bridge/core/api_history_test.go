package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func historyAPI(t *testing.T, p Platform) *APIServer {
	t.Helper()
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.platformReady = map[Platform]bool{p: true}
	return &APIServer{engines: map[string]*Engine{"lead": e}}
}

func getHistory(api *APIServer, url string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	api.handleChannelHistory(rec, httptest.NewRequest(http.MethodGet, url, nil))
	return rec
}

func TestChannelHistory_ReturnsMessages(t *testing.T) {
	at := time.Date(2026, 10, 26, 3, 0, 0, 0, time.UTC)
	p := &historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}, history: []ChannelHistoryMessage{
		{ID: "100", Author: "lead", AuthorID: "1", IsSelf: true, IsBot: true, Content: "<@2> do it", Time: at},
		{ID: "101", Author: "dragon", AuthorID: "2", IsBot: true, Content: "done", Time: at.Add(time.Minute)},
		{ID: "102", Author: "user", AuthorID: "3", Content: "ok", Time: at.Add(2 * time.Minute)},
	}}
	rec := getHistory(historyAPI(t, p), "/channel/history?project=lead&session_key=discord:555:3&limit=2")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var res ChannelHistoryResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Platform != "discord" || res.Channel != "555" || len(res.Messages) != 2 {
		t.Fatalf("result = %+v", res)
	}
	m := res.Messages[0]
	if m.ID != "101" || m.AuthorID != "2" || m.AuthorName != "dragon" || !m.IsBot || m.Content != "done" || !m.Time.Equal(at.Add(time.Minute)) {
		t.Fatalf("first message = %+v", m)
	}
	if res.Messages[1].IsBot {
		t.Fatalf("user message marked bot: %+v", res.Messages[1])
	}
}

func TestChannelHistory_UnsupportedPlatform(t *testing.T) {
	p := &stubPlatformEngine{n: "feishu"}
	rec := getHistory(historyAPI(t, p), "/channel/history?session_key=feishu:oc_1:u1")
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestChannelHistory_BadRequests(t *testing.T) {
	api := historyAPI(t, &historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}})
	for url, want := range map[string]int{
		"/channel/history": http.StatusBadRequest,
		"/channel/history?session_key=discord:1&limit=x":      http.StatusBadRequest,
		"/channel/history?session_key=discord:1&project=nope": http.StatusNotFound,
		"/channel/history?session_key=slack:1":                http.StatusServiceUnavailable,
	} {
		if rec := getHistory(api, url); rec.Code != want {
			t.Errorf("%s: status = %d, want %d (%s)", url, rec.Code, want, rec.Body.String())
		}
	}
	rec := httptest.NewRecorder()
	api.handleChannelHistory(rec, httptest.NewRequest(http.MethodPost, "/channel/history?session_key=discord:1", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d", rec.Code)
	}
}
