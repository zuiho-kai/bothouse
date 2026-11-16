package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"syscall"
	"time"
)

// bridgeDialWait is how long a command waits for a bridge that refuses the connection.
var bridgeDialWait = 30 * time.Second

var bridgeDialNotice sync.Once

// dialBridge connects to the bridge's API socket. A refused connection means the socket file is
// there and nothing listens on it: the bridge is restarting (a deploy, `daemon restart`), which
// takes ten to twenty seconds here. The dial is tried again until the bridge is back or
// bridgeDialWait has passed, so a command run during a restart is carried out instead of lost
// (#1729: 11-16 21:23 a ws-forward, its report reject and the timer meant to retry it all failed
// with 「connect: connection refused」 within eight seconds; 11-17 00:57 the same for a ws-forward
// that carried the lead's decision to a workspace). Any other error is returned at once.
func dialBridge(ctx context.Context, sock string) (net.Conn, error) {
	deadline := time.Now().Add(bridgeDialWait)
	for {
		c, err := (&net.Dialer{}).DialContext(ctx, "unix", sock)
		if err == nil || !bridgeRefused(err) || !time.Now().Before(deadline) {
			return c, err
		}
		bridgeDialNotice.Do(func() {
			fmt.Fprintf(os.Stderr, "bothouse is not answering on %s (restarting?); waiting up to %s for it\n", sock, bridgeDialWait)
		})
		select {
		case <-ctx.Done():
			return nil, err
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func bridgeRefused(err error) bool {
	// Windows reports WSAECONNREFUSED, which is not syscall.ECONNREFUSED there.
	return errors.Is(err, syscall.ECONNREFUSED) || strings.Contains(err.Error(), "refused")
}
