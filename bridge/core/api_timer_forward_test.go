package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// #75: the ws-forward notice must pass the API entry — 1m delay and the user's own wording
// (which can say 状态/回执). The identical request without the forward mark stays blocked,
// so the guard itself still catches status polling.
func TestHandleTimerAdd_ForwardNoticeAccepted(t *testing.T) {
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	api := &APIServer{timer: NewTimerScheduler(store)}

	post := func(forward bool) *httptest.ResponseRecorder {
		body, err := json.Marshal(TimerAddRequest{
			Project:     "p",
			SessionKey:  "discord:ws-3",
			Delay:       "1m",
			Description: "工作区转交",
			Prompt:      "主频道转来一条话，按这条做：额度恢复了没，回执发我",
			Forward:     forward,
		})
		if err != nil {
			t.Fatal(err)
		}
		rec := httptest.NewRecorder()
		api.handleTimerAdd(rec, httptest.NewRequest(http.MethodPost, "/timer/add", bytes.NewReader(body)))
		return rec
	}

	if rec := post(true); rec.Code != http.StatusOK {
		t.Fatalf("forwarded notice must be accepted, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec := post(false); rec.Code != http.StatusBadRequest {
		t.Fatalf("the same 1m poll text without the mark must stay blocked, got %d", rec.Code)
	}
}
