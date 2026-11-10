package core

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A handler that never reads its body, a client that sends "Connection: close" and the body a moment
// after the headers (Python urllib, windows-e2e POST /setup/dsh/open): the response must arrive whole
// and the connection end with FIN, not a reset (#1392).
func TestManagementWrapDrainsUnreadBodyBeforeClose(t *testing.T) {
	m := NewManagementServer(0, "tok", nil)
	srv := httptest.NewServer(m.wrap(func(w http.ResponseWriter, r *http.Request) {
		mgmtJSON(w, http.StatusOK, map[string]string{"url": "x"})
	}))
	defer srv.Close()

	conn, err := net.Dial("tcp", strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	head := "POST /x HTTP/1.1\r\nHost: a\r\nAuthorization: Bearer tok\r\nContent-Type: application/json\r\n" +
		"Content-Length: 2\r\nConnection: close\r\n\r\n"
	if _, err := conn.Write([]byte(head)); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond) // the body lands after the server has read the headers
	if _, err := conn.Write([]byte("{}")); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond) // let a reset, if any, arrive before the first read
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatalf("response lost: %v", err)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("body cut by a reset: %v (got %q)", err, body)
	}
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), `"url"`) {
		t.Fatalf("got %d %q", resp.StatusCode, body)
	}
	// macOS and Linux still hand over the response before the reset; Windows drops it. The end of the
	// stream tells the two closes apart everywhere.
	if _, err := br.ReadByte(); err != io.EOF {
		t.Fatalf("connection should end with FIN after the response, got %v", err)
	}
}
