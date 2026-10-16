package testutil

import (
	"net/http"
	"testing"
)

type countingTransport struct{ calls int }

func (t *countingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	t.calls++
	return &http.Response{StatusCode: http.StatusNoContent, Body: http.NoBody}, nil
}

func TestLocalTransportRejectsExternalBeforeDial(t *testing.T) {
	for _, tc := range []struct {
		url   string
		local bool
	}{
		{"http://127.0.0.1:1234/test", true},
		{"http://[::1]:1234/test", true},
		{"https://bots.qq.com/test", false},
		{"http://unused/test", false},
		{"http://192.0.2.1/test", false},
	} {
		t.Run(tc.url, func(t *testing.T) {
			base := &countingTransport{}
			guard := &localTransport{base: base}
			req, err := http.NewRequest(http.MethodGet, tc.url, nil)
			if err != nil {
				t.Fatal(err)
			}
			_, err = guard.RoundTrip(req)
			if tc.local {
				if err != nil || base.calls != 1 || guard.rejected.Load() != 0 {
					t.Fatalf("local request: calls=%d rejected=%d err=%v", base.calls, guard.rejected.Load(), err)
				}
			} else if err == nil || base.calls != 0 || guard.rejected.Load() != 1 {
				t.Fatalf("external request reached transport: calls=%d rejected=%d err=%v", base.calls, guard.rejected.Load(), err)
			}
		})
	}
}
