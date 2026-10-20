package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// The gate is told whether a message came from a teammate bot, so it can tell a user's message that
// @-s the lead and a sub together (the sub answers, the lead waits for its @) from the sub's answer
// @-ing the lead (issue #182).
func TestGateRequestCarriesFromBot(t *testing.T) {
	var mu sync.Mutex
	var reqs []gateRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req gateRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		reqs = append(reqs, req)
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(gateResponse{Action: "silent"})
	}))
	defer srv.Close()
	e := newTestEngine()
	e.SetGate(srv.URL, 2000, "reply")
	s := &Session{}
	for _, m := range []*Message{
		{SessionKey: "cloud_web:room-2", Content: "@橘(你) <@2> 帮我算", Mentioned: true},
		{SessionKey: "cloud_web:room-2", Content: "【龙娘】<@1> 391", Mentioned: true, FromBot: true},
	} {
		e.gate.released[m] = true
		e.applyGate(nil, m, s, "k")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(reqs) != 2 || reqs[0].FromBot || !reqs[1].FromBot {
		t.Fatalf("from_bot not passed through: %+v", reqs)
	}
}
