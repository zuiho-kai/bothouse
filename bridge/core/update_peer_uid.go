package core

import (
	"net"
	"net/http"
	"os/user"
	"strconv"
)

// The uid of the process on the other end of a local socket connection. /member is reachable from a
// socket any local account may connect to (member_socket.go), so the handler has to ask the kernel who
// is calling before it trusts a turn record: SO_PEERCRED on Linux, LOCAL_PEERCRED (xucred) on macOS,
// both read from the accepted connection, never from the request body.
//
// Same-process callers (tests, in-process tools) have no unix connection; they are the bridge's own
// account by definition, so ok=false means "same account" here.

// socketPeerUIDFn returns the uid of r's peer; ok=false when this platform cannot tell.
// Swappable in tests.
var socketPeerUIDFn = func(r *http.Request) (uint32, bool) {
	c, _ := r.Context().Value(peerConnKey{}).(net.Conn)
	uc, isUnix := c.(*net.UnixConn)
	if !isUnix {
		return 0, false
	}
	return unixPeerUID(uc)
}

// runAsUIDFn resolves a run_as_user login name to its uid; ok=false when the account does not exist
// here (then no request can match it). Swappable in tests.
var runAsUIDFn = func(name string) (uint32, bool) {
	u, err := user.Lookup(name)
	if err != nil {
		return 0, false
	}
	n, err := strconv.ParseUint(u.Uid, 10, 32)
	if err != nil {
		return 0, false
	}
	return uint32(n), true
}

// peerIsBridgeAccount reports whether r came from this process's own account. That account already
// holds api.sock (0600) and therefore full control of the bridge, so nothing new is granted to it.
//
// Unknown is not trusted: when the kernel cannot name the peer, the request must prove itself with a
// token (member_socket.go). The member socket is only started where peer credentials exist
// (memberSocketSupported), so a platform without them keeps today's api.sock-only behaviour.
func peerIsBridgeAccount(r *http.Request) bool {
	uid, ok := socketPeerUIDFn(r)
	return ok && uid == bridgeAccountUID()
}

// peerIsRunAsUser reports whether r came from the project's configured run_as_user account — the only
// other account that may ask for member operations, and only with a caller token for its own turn.
func peerIsRunAsUser(r *http.Request, name string) bool {
	if name == "" {
		return false
	}
	want, ok := runAsUIDFn(name)
	if !ok {
		return false
	}
	uid, ok := socketPeerUIDFn(r)
	return ok && uid == want
}
