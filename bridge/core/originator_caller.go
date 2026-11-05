package core

import (
	"net"
	"net/http"
	"os"
	"strings"
)

// Who may ask the bridge to sign an originator ticket.
//
// POST /originator/sign hands out a ticket that names the person whose platform
// message started the running turn. The request body names project and session,
// and those values come from CC_PROJECT / CC_SESSION_KEY — environment the model
// itself can set before it execs the CLI. So the body proves nothing.
//
// This file asks the kernel instead. The unix socket tells us the peer pid; we
// walk its ancestry and accept only a process that the bridge process itself
// started (its direct child) and whose environment carries both CC_AGENT and a
// session key. The bridge wrote that environment into that child when it started
// the turn, so the model cannot choose it.
//
// Requiring "parent is the bridge" is what makes this hold: a model can set
// CC_AGENT/CC_SESSION_KEY in its own shell and exec this CLI with a forged
// session name, but that shell's parent is an agent process, not the bridge, so
// the forged variables are never read. Only the bridge's own children are.
//
// What this is not: same-uid processes can still read the bridge's private key
// and sign anything themselves. This is a caller check, not the key isolation a
// separate OS user would give.
const originatorCallerEnvAgent = "CC_AGENT"

// Swappable in tests: the real socket peer is not available there, and the
// ancestry walk needs a fake process tree to be exercised at all.
var (
	originatorCallerFn   = originatorCallerSession
	originatorParentPID  = parentProcessID
	originatorProcessEnv = processEnvironment
	originatorBridgePID  = os.Getpid
)

// originatorCallerSession returns the project and session of the agent process
// the bridge started for the caller's turn.
func originatorCallerSession(r *http.Request) (project, session string, ok bool) {
	c, _ := r.Context().Value(peerConnKey{}).(net.Conn)
	uc, isUnix := c.(*net.UnixConn)
	if !isUnix {
		return "", "", false
	}
	pid, ok := peerProcessID(uc)
	if !ok {
		return "", "", false
	}
	return originatorCallerFromPID(pid, originatorBridgePID())
}

// originatorCallerFromPID walks pid's ancestry for the agent process the bridge
// started. Only a direct child of bridgePID was started — and given its
// environment — by the bridge. A descendant of such a child is fine: it inherits
// that environment, which is how the model's own shell (a grandchild) asks for
// its own turn while its forged variables are ignored.
func originatorCallerFromPID(pid, bridgePID int) (project, session string, ok bool) {
	seen := make(map[int]bool)
	for pid > 0 && !seen[pid] {
		seen[pid] = true
		parent := originatorParentPID(pid)
		if parent == bridgePID {
			if env, ok := originatorProcessEnv(pid); ok {
				values := parseProcessEnv(env)
				if values[originatorCallerEnvAgent] != "" && values["CC_SESSION_KEY"] != "" {
					return values["CC_PROJECT"], values["CC_SESSION_KEY"], true
				}
			}
		}
		pid = parent
	}
	return "", "", false
}

// parseProcessEnv reads a NUL-separated environment block into its values.
// First occurrence wins, matching how a process's own environment resolves.
func parseProcessEnv(block []byte) map[string]string {
	values := make(map[string]string)
	for _, entry := range strings.Split(string(block), "\x00") {
		if entry == "" {
			continue
		}
		key, value, found := strings.Cut(entry, "=")
		if !found || key == "" {
			continue
		}
		if _, dup := values[key]; !dup {
			values[key] = value
		}
	}
	return values
}

// parentProcessID is the parent's pid, 0 when unknown. Platform-specific.
// peerProcessID is the unix socket peer's pid. Platform-specific.
