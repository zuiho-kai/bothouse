package core

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Who is asking the running bothouse to update itself. POST /update on the local socket replaces
// this process's own binary, so only this same program may ask for it: on 2026-10-25 a separate
// copy (an isolated test build at /tmp/iso.*/bin/bothouse) found this instance's socket through
// the shared HOME and made it replace itself. The socket server records each connection; the
// handler asks the kernel for the peer's pid (LOCAL_PEERPID on macOS, SO_PEERCRED on Linux) and
// compares that process's executable with ours.

type peerConnKey struct{}

// withPeerConn is the API server's http.Server.ConnContext: keeps the connection for handlers.
func withPeerConn(ctx context.Context, c net.Conn) context.Context {
	return context.WithValue(ctx, peerConnKey{}, c)
}

// socketPeerExeFn returns the executable of the process on the other end of r's unix socket
// connection; ok=false when this platform cannot tell (then the request must name its exe).
// Swappable in tests.
var socketPeerExeFn = func(r *http.Request) (string, bool) {
	c, _ := r.Context().Value(peerConnKey{}).(net.Conn)
	uc, isUnix := c.(*net.UnixConn)
	if !isUnix {
		return "", false
	}
	return unixPeerExe(uc)
}

// procExeTarget turns a Linux /proc/<pid>/exe link target into the peer's executable path. When
// the file was replaced or removed while the process runs (an ordinary upgrade renames the old
// binary away), the kernel appends " (deleted)"; drop it like os.Executable does, so the path
// still names the installed program. ok=false for an empty target.
func procExeTarget(target string) (string, bool) {
	exe := strings.TrimSuffix(target, " (deleted)")
	if exe == "" {
		return "", false
	}
	return exe, true
}

// normalizeProgramPath resolves symlinks (PATH links into an .app, npm bin links) and maps an
// update backup (bothouse.old-N, what a process started before an update may report) back to
// the installed binary, the same way the update itself names the binary (updateExePath).
func normalizeProgramPath(p string) string {
	if p == "" {
		return ""
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return filepath.Clean(BinaryFromBackupPath(p))
}

// SameProgram reports whether a and b name the same installed bothouse binary.
func SameProgram(a, b string) bool {
	a, b = normalizeProgramPath(a), normalizeProgramPath(b)
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	ia, errA := os.Stat(a)
	ib, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(ia, ib)
}
