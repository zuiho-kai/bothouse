package core

import (
	"net/http"
	"testing"
)

func TestFriendSharesRequireAuthenticatedManagerAndExactNumber(t *testing.T) {
	for _, token := range []string{"", "token"} {
		m, server, _ := testManagementServer(t, token)
		calls := 0
		m.SetFriendShares(func(project, number string, allow bool) ([]string, error) {
			calls++
			if project != "test-project" || number != "paper_01" || !allow {
				t.Fatalf("unexpected update %q %q %t", project, number, allow)
			}
			return []string{number}, nil
		})
		for _, c := range []struct {
			number string
			status int
		}{{"p", 400}, {"paper_01", 200}} {
			req, err := http.NewRequest(http.MethodPut, server.URL+"/api/v1/projects/test-project/friend-shares/"+c.number, nil)
			if err != nil {
				t.Fatal(err)
			}
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			res, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			want := c.status
			if token == "" {
				want = 403
			}
			if res.StatusCode != want {
				t.Fatalf("got %d, want %d", res.StatusCode, want)
			}
		}
		if (token == "" && calls != 0) || (token != "" && calls != 1) {
			t.Fatalf("unexpected write count %d", calls)
		}
	}
}
