package core

import (
	"bufio"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// #1726: Stop() used to wait the full 5-second Shutdown timeout when a client
// held an open SSE connection to /api/v1/roles/events, because the handler
// blocked on r.Context() and http.Server.Shutdown does not cancel in-flight
// request contexts. The fix gives the server a cancellable BaseContext so that
// Stop() can signal all handlers before calling Shutdown.
func TestManagementStopWithActiveSSEConnection(t *testing.T) {
	token := "test-token-1726"
	mgmt := NewManagementServer(0, token, nil)
	mgmt.Start()
	t.Cleanup(func() {
		// guard: if the test already stopped it, Stop is idempotent
		mgmt.Stop()
	})

	// Connect to the SSE endpoint and consume the first event (snapshot) so the
	// handler is definitely blocking in the event loop, not in startup code.
	url := fmt.Sprintf("http://127.0.0.1:%d/api/v1/roles/events", mgmt.port)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	// Read until we see the first "data:" line so we know the handler is live.
	scanner := bufio.NewScanner(resp.Body)
	started := make(chan struct{})
	go func() {
		for scanner.Scan() {
			line := scanner.Text()
			if len(line) >= 5 && line[:5] == "data:" {
				select {
				case started <- struct{}{}:
				default:
				}
			}
		}
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("SSE stream did not emit initial snapshot within 5s")
	}

	// Now stop the server. With the fix it should finish well under 1 second
	// because Stop() cancels the base context before calling Shutdown.
	stopDone := make(chan struct{})
	stopStart := time.Now()
	go func() {
		mgmt.Stop()
		close(stopDone)
	}()
	select {
	case <-stopDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop() did not return within 2s with an active SSE connection; expected < 1s after fix")
	}
	elapsed := time.Since(stopStart)
	if elapsed >= 2*time.Second {
		t.Errorf("Stop() took %v; expected < 1s", elapsed)
	}
}
