package qq

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestSendFilePropagatesHTTPFailure(t *testing.T) {
	for _, chat := range []string{"group", "private"} {
		for _, tc := range []struct {
			name   string
			status int
			body   string
			want   string
		}{
			{"unauthorized JSON", 401, `{"error":"unauthorized"}`, "HTTP 401"},
			{"server JSON", 500, `{"error":"unavailable"}`, "HTTP 500"},
			{"gateway HTML", 502, `<html>unavailable</html>`, "HTTP 502"},
			{"API failure", 200, `{"status":"failed","retcode":1400,"message":"rejected"}`, "retcode=1400"},
			{"success", 200, `{"status":"ok","retcode":0,"data":{}}`, ""},
		} {
			t.Run(chat+"/"+tc.name, func(t *testing.T) {
				action := "send_private_msg"
				if chat == "group" {
					action = "upload_group_file"
				}
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method != http.MethodPost || r.URL.Path != "/"+action {
						t.Errorf("request = %s %s, want POST /%s", r.Method, r.URL.Path, action)
					}
					var params map[string]json.RawMessage
					if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
						t.Errorf("request body: %v", err)
					}
					payload := params["message"]
					if chat == "group" {
						payload = params["file"]
					}
					if !strings.Contains(string(payload), "base64://cGF5bG9hZA==") {
						t.Errorf("file bytes missing from upload: %s", payload)
					}
					w.WriteHeader(tc.status)
					_, _ = w.Write([]byte(tc.body))
				}))
				defer srv.Close()
				p := &Platform{httpURL: srv.URL}
				err := p.SendFile(context.Background(), &replyContext{messageType: chat, groupID: 77, userID: 33}, core.FileAttachment{FileName: "test.txt", Data: []byte("payload")})
				if tc.want == "" {
					if err != nil {
						t.Fatalf("successful upload: %v", err)
					}
				} else if err == nil || !strings.Contains(err.Error(), tc.want) || !strings.Contains(err.Error(), action) {
					t.Fatalf("SendFile = %v, want action %s and %q", err, action, tc.want)
				}
			})
		}
	}
}
