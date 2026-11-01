package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTaskTextFeishuReceiptAndRateLimit(t *testing.T) {
	for _, code := range []int{0, feishuIMRateLimitCode} {
		calls := 0
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if strings.Contains(r.URL.Path, "tenant_access_token") {
				_, _ = w.Write([]byte(`{"code":0,"tenant_access_token":"fixture","expire":7200}`))
				return
			}
			calls++
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["uuid"] == "" || body["receive_id"] != "oc_room" {
				t.Error("missing stable key or destination")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": code, "data": map[string]string{"message_id": "om_receipt"}})
		}))
		p := &Platform{platformName: "feishu", client: lark.NewClient("fixture-task", "secret", lark.WithOpenBaseUrl(srv.URL), lark.WithEnableTokenCache(false))}
		id, err := p.SendTaskTextPart(context.Background(), "feishu:oc_room", "delivery-key", "body")
		if code == 0 {
			if id != "om_receipt" || err != nil {
				t.Fatal(id, err)
			}
		} else if !errors.Is(err, core.ErrTaskTextNotAccepted) {
			t.Fatal("rate limit not retryable", err)
		}
		if calls != 1 {
			t.Fatal("hidden retries", calls)
		}
		srv.Close()
	}
}
